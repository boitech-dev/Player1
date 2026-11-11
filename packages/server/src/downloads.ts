// Downloads into the Jellyfin library: <MEDIA>/player1/films and /series, two Jellyfin libraries
// Player1 creates. Bytes are copied as they are (RD, qBittorrent, indexer releases through
// qBittorrent): nothing is converted. One copy at a time.
import crypto from 'node:crypto';
import fs from 'node:fs';
import type { IncomingMessage } from 'node:http';
import https from 'node:https';
import path from 'node:path';
import type { Readable } from 'node:stream';

import { msg } from '@lingui/core/macro';

import type {
	Download,
	DownloadBody,
	Downloads,
	PendingInfo,
} from '@player1/shared/api';

import {
	db,
	save,
} from './db.ts';
import type {
	GetHandlers,
	PostHandlers,
} from './http.ts';
import { UserError } from './i18n.ts';
import {
	type QbFile,
	qbFile,
	qbTorrent,
} from './qbit.ts';
import {
	isTz,
	MEDIA,
	namesOf,
	resolve,
	tzHash,
	tzTorrent,
} from './sources.ts';
import {
	errMsg,
	warn,
} from './upstream.ts';

const DL_DIR = `${MEDIA}/player1`, JF = (process.env.JELLYFIN_URL || '').replace(/\/$/, '');
const JF_KEY = JF && process.env.JELLYFIN_KEY || '';
const jf = (where: string, opts: RequestInit = {}) => fetch(JF + where, {
	...opts,
	headers: {
		'X-Emby-Token': JF_KEY,
		'content-type': 'application/json',
		...opts.headers,
	},
});
const safeName = (x?: string) => String(x || '')
	.replace(/[\\/:*?"<>|]+/g, ' ')
	.replace(/\s+/g, ' ')
	.trim();
const pad = (n?: number) => String(n).padStart(2, '0');

interface VirtualFolder { Name: string; Locations?: string[] }
const folders = async () => await (await jf('/Library/VirtualFolders')).json() as VirtualFolder[];
// Jellyfin may see the drive under another path: derive it from its existing libraries (…/movies
// here is …/movies there)
async function jfPath(local: string) {
	const locs = (await folders()).flatMap(f => f.Locations || []).map(l => l.replace(/\/$/, ''));
	if (locs.some(l => l.startsWith(MEDIA + '/'))) return local; // same path on both sides
	for (const l of locs) for (const sub of ['movies', 'series']) {
		if (l.endsWith('/' + sub)) return l.slice(0, -sub.length) + local.slice(MEDIA.length + 1);
	}
	return local;
}
const LIBRARIES = [
	['Player1 films', 'movies', 'films'],
	['Player1 séries', 'tvshows', 'series'],
] as const;
// "Player1 films" and "Player1 séries", created once
export async function jfLibraries() {
	if (!JF_KEY) return;
	const have = (await folders()).map(f => f.Name);
	for (const [name, type, sub] of LIBRARIES) if (!have.includes(name)) {
		const qs = new URLSearchParams({
			name,
			collectionType: type,
			paths: await jfPath(`${DL_DIR}/${sub}`),
			refreshLibrary: 'true',
		});
		const r = await jf(`/Library/VirtualFolders?${qs}`, {
			method: 'POST',
			body: JSON.stringify({ LibraryOptions: {} }),
		});
		console.log('jellyfin library', name, r.status);
	}
}
// a library scan picks the new file up within seconds (Jellyfin 10.11 ignores the lighter "media
// updated" notice for new folders)
const jfAdded = async () => {
	if (JF_KEY) await jf('/Library/Refresh', { method: 'POST' }).catch(() => {});
};
const free = async () => {
	const st = await fs.promises.statfs(DL_DIR);
	return st.bavail * st.bsize;
};
const gb = (n: number) => `${(n / 1e9).toFixed(1)} GB`;

// where a release lands, named the way Jellyfin recognises it (the IMDb tag pins the exact title)
function target(job: Download, name: string) {
	const ext = (/\.(mkv|mp4|m4v|avi|webm)$/i.exec(name)?.[1] || 'mkv').toLowerCase();
	const t = safeName(job.title), y = job.year ? ` (${job.year})` : '', label = safeName(job.label);
	const folder = `${t}${y}${job.q.imdb ? ` [imdbid-${job.q.imdb}]` : ''}`, more = label && ' - ' + label;
	if (job.q.type !== 'series') return `${DL_DIR}/films/${folder}/${t}${y}${more}.${ext}`;
	return `${DL_DIR}/series/${folder}/Season ${pad(job.q.s)}/${t} S${pad(job.q.s)}E${pad(job.q.e)}${more}.${ext}`;
}

type Source = QbFile & { name: string };
// the file behind a source: { url | file, headers, name } or { pending } while qBittorrent still
// fetches a release
async function dlSource(job: Download): Promise<Source | { pending: PendingInfo }> {
	const u = job.url;
	if (u.startsWith('jf:')) throw new Error('Already in Jellyfin');
	if (/^(tz|c411|wb):/.test(u)) {
		const got = await qbTorrent(tzHash(u), job.q, isTz(u) && tzTorrent(u));
		if (!got) throw new Error('No longer in qBittorrent or on the indexer: search again');
		if ('pending' in got) return got;
		return {
			...await qbFile(got),
			name: got.path.split('/').pop() ?? got.path,
		};
	}
	const r = await resolve(u);
	return {
		url: r.direct ?? '',
		headers: {},
		name: r.file ?? '',
	};
}
// node:https: steady on multi-GB bodies
type Headers = Record<string, string>;
const get = (url: string, headers: Headers, hops = 3) => new Promise<IncomingMessage>((ok, ko) => {
	https.get(url, { headers }, r => {
		const status = r.statusCode ?? 0;
		if (status >= 300 && status < 400 && r.headers.location && hops) {
			r.resume();
			return ok(get(new URL(r.headers.location, url).href, headers, hops - 1));
		}
		ok(r);
	}).on('error', ko);
});

interface Body { stream: Readable; status: number; length: number }
async function open(src: Source, have: number): Promise<Body> {
	if ('file' in src) return {
		stream: fs.createReadStream(src.file, { start: have }),
		status: 206,
		length: (await fs.promises.stat(src.file)).size - have,
	};
	const r = await get(src.url, {
		...src.headers,
		...(have ? { Range: `bytes=${have}-` } : {}),
	});
	return {
		stream: r,
		status: r.statusCode ?? 0,
		length: +(r.headers['content-length'] ?? 0) || 0,
	};
}

const dlRun = new Map<string, Readable>(); // id -> request in progress (to cancel)
const cancelled = (job: Download) => job.status === 'cancelled';
function pipe(job: Download, r: Readable, part: string, resumed: boolean) {
	return new Promise<void>((ok, ko) => {
		const out = fs.createWriteStream(part, {
			flags: resumed ? 'a' : 'w',
			mode: 0o666,
		});
		dlRun.set(job.id, r);
		let last = Date.now(), lastDone = job.done;
		r.on('data', (d: Buffer) => {
			job.done += d.length;
			const now = Date.now();
			if (now - last > 1000) {
				job.speed = (job.done - lastDone) / ((now - last) / 1000);
				last = now;
				lastDone = job.done;
			}
		});
		r.on('error', ko).on('aborted', () => ko(new Error('Interrupted')));
		out.on('error', ko).on('finish', ok);
		r.pipe(out);
	}).finally(() => dlRun.delete(job.id));
}
async function copy(job: Download, src: Source) {
	const final = target(job, src.name), part = job.part = final + '.part';
	const have = (await fs.promises.stat(part).catch(() => null))?.size || 0;
	// NFS maps us to "nobody": leave everything open, like the rest of the library
	await fs.promises.mkdir(path.dirname(final), {
		recursive: true,
		mode: 0o777,
	});
	const r = await open(src, have);
	if (r.status !== 200 && r.status !== 206) {
		r.stream.resume();
		throw new Error(`Source ${r.status}`);
	}
	const resumed = r.status === 206, rest = r.length;
	job.total = (resumed ? have : 0) + rest;
	job.done = resumed ? have : 0;
	if (rest > await free() - 2e9) {
		r.stream.destroy();
		throw new Error(`Not enough space: ${gb(rest)} needed, ${gb(await free())} free`);
	}
	job.status = 'copying';
	save();
	await pipe(job, r.stream, part, resumed);
	if (cancelled(job)) return;
	if (job.total && job.done < job.total) throw new Error('Incomplete copy');
	await fs.promises.rename(part, final);
	job.status = 'done';
	job.file = final.slice(DL_DIR.length + 1);
	job.speed = 0;
	save();
	void jfAdded();
}

let dlBusy = false;
const due = (d: Download) => d.status === 'queued'
	|| (d.status === 'whatbox' && !((d.retryAt ?? 0) > Date.now()));
async function pump() {
	if (dlBusy) return;
	const job = (db.downloads ||= []).slice().reverse().find(due);
	if (!job) return;
	dlBusy = true;
	try {
		await jfLibraries().catch(warn('jellyfin'));
		const src = await dlSource(job);
		if ('pending' in src) { // qBittorrent is fetching the release: check again soon
			job.status = 'whatbox';
			job.wb = src.pending;
			job.retryAt = Date.now() + 10e3;
		} else await copy(job, src);
	} catch (err) {
		if (!cancelled(job)) {
			job.status = 'error';
			job.err = errMsg(err);
			console.warn('download', job.title, errMsg(err));
		} else if (job.part) fs.promises.unlink(job.part).catch(() => {});
	} finally {
		dlBusy = false;
		save();
		setTimeout(pump, 1000);
	}
}
// interrupted by a restart: resumes where the .part stopped
for (const d of db.downloads || []) if (d.status === 'copying') d.status = 'queued';
// the background work: not while run.mjs tries an update on a copy of the data (P1_TRIAL)
export function startDownloads() {
	setInterval(pump, 10e3);
	setTimeout(pump, 3000);
	setTimeout(() => jfLibraries().catch(warn('jellyfin')), 4000);
}
const dlKey = (b: DownloadBody) => [b.imdb, b.s, b.e].filter(x => x != null && x !== '').join(':');

const list = async (): Promise<Downloads> => ({
	downloads: (db.downloads || []).slice(0, 40),
	free: await free().catch(() => null),
	jellyfin: !!JF_KEY,
});

export const downloadGets: GetHandlers = { downloads: list };

export const downloadPosts: PostHandlers = {
	download: async b => {
		if (!MEDIA) throw new UserError(msg`The Jellyfin library folder isn’t set in the server settings`);
		if (!b.url || !b.imdb) throw new UserError(msg`Source or title missing`);
		const key = dlKey(b), all = db.downloads ||= [];
		const live = (d: Download) => d.key === key && d.url === b.url && !/error|cancelled/.test(d.status);
		if (!all.some(live)) all.unshift({
			id: crypto.randomBytes(6).toString('hex'),
			key,
			url: b.url,
			title: b.title,
			year: b.year || (await namesOf(b.imdb).catch(() => null))?.year,
			label: b.label,
			size: b.size,
			q: {
				type: b.type,
				imdb: b.imdb,
				s: b.s,
				e: b.e,
			},
			status: 'queued',
			at: Date.now(),
			done: 0,
		});
		save();
		void pump();
		return list();
	},
	'download/cancel': async ({ id }) => {
		const d = (db.downloads || []).find(x => x.id === id);
		if (!d) throw new UserError(msg`Download not found`);
		if (/queued|whatbox|copying/.test(d.status)) {
			d.status = 'cancelled';
			dlRun.get(id)?.destroy();
		} else db.downloads = (db.downloads || []).filter(x => x.id !== id); // finished or failed: forget it (the file stays in Jellyfin)
		save();
		return list();
	},
};
