// qBittorrent (a seedbox such as Whatbox, or one at home): fetches and seeds indexer releases; the
// page plays the finished file with its own decoder, through a byte relay here. Files are read
// from QBIT_FILES (qBittorrent's download folder as this server sees it: same machine, NFS,
// SMB…) or, on Whatbox, from its file site with the slot login. Never any conversion.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import type {
	IncomingMessage,
	OutgoingHttpHeaders,
	ServerResponse,
} from 'node:http';
import https from 'node:https';

import { msg } from '@lingui/core/macro';

import type {
	MediaTrack,
	Outro,
	PendingInfo,
	StreamsQuery,
} from '@player1/shared/api';
import type { VideoInfo } from '@player1/shared/release';

import { UserError } from './i18n.ts';
import {
	type Chapter,
	outroIn,
} from './outro.ts';
import { videoFile } from './torznab.ts';

const { QBIT_URL = '', QBIT_USER = '', QBIT_PASS = '', QBIT_FILES = '' } = process.env;
export const qbOn = !!QBIT_URL;
// how the interface names it
export const SEEDBOX = /box\.ca/.test(QBIT_URL) ? 'Whatbox' : 'qBittorrent';
// https://files.<slot>.box.ca
const FILES = !QBIT_FILES && /\/\/qbittorrent\.[^/]*box\.ca/.test(QBIT_URL)
	? QBIT_URL.replace(/\/\/qbittorrent\./, '//files.').replace(/\/$/, '')
	: '';

/** a torrent, as qBittorrent lists it */
export interface QbTorrent {
	hash: string;
	name: string;
	progress: number;
	size: number;
	save_path: string;
	dlspeed: number;
	num_seeds: number;
}

// --- qBittorrent WebUI (slot username and password) ---
let sid: string | undefined, root: string | undefined;
const login = async (base: string, headers: Record<string, string>) => {
	const r = await fetch(`${base}/api/v2/auth/login`, {
		method: 'POST',
		headers,
		body: new URLSearchParams({
			username: QBIT_USER,
			password: QBIT_PASS,
		}),
	});
	return /\w*SID\w*=[^;]+/.exec(r.headers.get('set-cookie') || '')?.[0];
};
// the answer's shape is qBittorrent's documented one: callers say which
export async function qbit<T>(path: string, body?: FormData, retry = true): Promise<T> {
	const base = QBIT_URL.replace(/\/$/, ''), headers = {
		Referer: base,
		Origin: new URL(base).origin,
	};
	sid ||= await login(base, headers);
	if (!sid) throw new Error('qBittorrent login refused');
	const r = await fetch(`${base}/api/v2${path}`, {
		method: body ? 'POST' : 'GET',
		headers: {
			...headers,
			Cookie: sid,
		},
		body,
	});
	if (r.status === 403) {
		sid = undefined;
		if (retry) return qbit(path, body, false);
		throw new Error('qBittorrent session refused');
	}
	if (!r.ok) throw new Error(`qBittorrent ${path} ${r.status}`);
	return (/json/.test(r.headers.get('content-type') ?? '') ? await r.json() : await r.text()) as T;
}

/** a finished release's video: on this server's disk (local), else a path on Whatbox */
export interface QbPlace {
	path: string;
	local?: boolean;
}
export type QbGot = { pending: PendingInfo } | QbPlace;

const info = async (hash: string) => (await qbit<QbTorrent[]>(`/torrents/info?hashes=${hash}`))[0];
async function add(torrent: () => Promise<Buffer>) {
	const fd = new FormData();
	fd.append('torrents', new Blob([new Uint8Array(await torrent())]), 'release.torrent');
	fd.append('category', 'player1');
	await qbit('/torrents/add', fd);
}

// a release in qBittorrent: null (not there, no torrent given), { pending } while it downloads,
// then { path, local }: local = a file on this server's disk, else a path on Whatbox (relative
// to the slot home)
export async function qbTorrent(
	hash: string,
	q: StreamsQuery,
	torrent?: (() => Promise<Buffer>) | false,
): Promise<QbGot | null> {
	let t = await info(hash);
	if (!t) {
		if (!torrent) return null;
		await add(torrent);
		t = await info(hash);
		if (!t) return {
			pending: {
				status: 'queued',
				progress: 0,
			},
		};
	}
	if (t.progress < 1) return {
		pending: {
			status: 'downloading',
			progress: Math.floor(t.progress * 100),
			speed: t.dlspeed,
			seeders: t.num_seeds,
		},
	};
	return placeOf(t, q);
}

async function placeOf(t: QbTorrent, q: StreamsQuery): Promise<QbPlace> {
	const files = await qbit<{ name: string; size: number }[]>(`/torrents/files?hash=${t.hash}`);
	const f = videoFile(files.map((x, id) => ({
		id,
		path: x.name,
		bytes: x.size,
	})), q.type === 'series' && Number(q.s), Number(q.e));
	if (!f) throw new UserError(msg`This download contains no video.`);
	const full = `${t.save_path.replace(/\/$/, '')}/${f.path}`;
	if (!QBIT_FILES && !FILES) throw new UserError(msg`qBittorrent’s download folder is missing from the server settings`);
	if (!QBIT_FILES) return { path: full.replace(/^\/home\/[^/]+\//, '') };
	// ponytail: maps paths under qBittorrent's default save folder; a torrent saved elsewhere
	// isn't found here
	root ||= (await qbit<{ save_path: string }>('/app/preferences')).save_path.replace(/\/$/, '');
	return {
		path: QBIT_FILES.replace(/\/$/, '') + full.slice(root.length),
		local: true,
	};
}

// --- Whatbox file access (same slot login as its qBittorrent) ---
let cookie: string | null = null, cookieAt = 0;
async function files() {
	if (cookie && Date.now() - cookieAt < 3600e3) return cookie;
	const g = await fetch(FILES + '/login');
	const csrf = /name="csrf_token"[^>]*value="([^"]+)"/.exec(await g.text())?.[1] || '';
	const first = g.headers.getSetCookie().map(c => c.split(';')[0]);
	const r = await fetch(FILES + '/login', {
		method: 'POST',
		redirect: 'manual',
		headers: {
			Cookie: first.join('; '),
			'content-type': 'application/x-www-form-urlencoded',
		},
		body: new URLSearchParams({
			csrf_token: csrf,
			username: QBIT_USER,
			password: QBIT_PASS,
			keeplogged: '1',
		}),
	});
	if (r.status !== 303 && r.status !== 302) throw new Error(`Whatbox files login ${r.status}`);
	cookie = [...first, ...r.headers.getSetCookie().map(c => c.split(';')[0])].join('; ');
	cookieAt = Date.now();
	return cookie;
}
const fileUrl = (path: string) => {
	return `${FILES}/download/${path.split('/').map(encodeURIComponent).join('/')}`;
};
/** a finished file to copy: on this disk, or a plain HTTP download from Whatbox */
export type QbFile = { file: string } | { url: string; headers: Record<string, string> };
// a finished file to copy into the Jellyfin library: on this disk, or a plain HTTP download
// from Whatbox
export async function qbFile({ path, local }: QbPlace): Promise<QbFile> {
	if (local) return { file: path };
	return {
		url: fileUrl(path),
		headers: { Cookie: await files() },
	};
}
const run = (cmd: string, args: string[]) => new Promise<string>((ok, ko) => {
	const p = spawn(cmd, args), out: Buffer[] = [], err: Buffer[] = [];
	p.stdout.on('data', (d: Buffer) => out.push(d));
	p.stderr.on('data', (d: Buffer) => err.push(d));
	p.on('close', code => code
		? ko(new Error(`${cmd} ${code}: ${Buffer.concat(err).toString().slice(-300)}`))
		: ok(Buffer.concat(out).toString()));
});

// tracks of a finished file, in the shape RD media infos have: audio/subs [{ id, iso, label }],
// plus the HLS url template
const NAMES: Record<string, string> = {
	fre: 'French',
	fra: 'French',
	eng: 'English',
	jpn: 'Japanese',
	spa: 'Spanish',
	ger: 'German',
	deu: 'German',
	ita: 'Italian',
	kor: 'Korean',
	chi: 'Chinese',
	zho: 'Chinese',
	por: 'Portuguese',
	rus: 'Russian',
};
const IMAGE_SUBS = /pgs|dvd_sub|dvb_sub|xsub/;
// relay links carry the file location, signed: they keep working across server restarts
const sign = (s: string) => crypto.createHmac('sha256', process.env.ACCESS_KEY ?? '')
	.update(s)
	.digest('base64url')
	.slice(0, 22);
/** where a relayed file is: true = this server's disk, 'url' = a plain https link, else Whatbox */
type Local = boolean | 'url' | undefined;
interface Place { path: string; local?: Local }
const tokenOf = (m: Place) => {
	const s = Buffer.from(JSON.stringify(m)).toString('base64url');
	return `${s}.${sign(s)}`;
};
const fromToken = (t = '') => {
	const [s, h] = t.split('.');
	return s && h === sign(s) ? JSON.parse(Buffer.from(s, 'base64url').toString()) as Place : null;
};

interface ProbeStream {
	index: number;
	codec_type: string;
	codec_name: string;
	height?: number;
	pix_fmt?: string;
	disposition?: { forced?: number };
	tags?: { language?: string; title?: string };
}
interface ProbeInfo {
	streams: ProbeStream[];
	format: { duration: string; bit_rate?: string };
	chapters?: Chapter[];
}

/** a file's tracks and the ways to play it: Real-Debrid's media infos, or ffprobe's */
export interface Media {
	file?: string;
	/** Real-Debrid's original file */
	direct?: string;
	/** Real-Debrid's HLS url template */
	model?: string;
	/** the file through this server's relay */
	wb?: string;
	duration?: number;
	formats?: Record<string, string>;
	qualities?: Record<string, string>;
	audio: MediaTrack[];
	subs: MediaTrack[];
	video?: VideoInfo;
	bitrate?: number;
	res?: number;
	/** the end credits, when the file's chapters mark them */
	outro?: Outro;
}

const label = (s: ProbeStream) => {
	const iso = s.tags?.language || 'und';
	const forced = s.disposition?.forced || /forc/i.test(s.tags?.title || '');
	return {
		iso,
		label: (NAMES[iso] || s.tags?.title || iso) + (forced ? ' (forced)' : ''),
	};
};
const resOfHeight = (h = 0) => {
	if (h >= 2000) return 2160;
	if (h >= 1000) return 1080;
	return h >= 700 ? 720 : 480;
};
const videoOf = (v?: ProbeStream): VideoInfo | undefined => v && {
	codec: v.codec_name,
	bits: /1[02]le|p010/.test(v.pix_fmt || '') ? 10 : 8,
	height: v.height ?? 0,
};

// path: relative to the Whatbox home, or (local) an absolute path on this server's disk, e.g. the
// Jellyfin library
export async function probe(path: string, local: Local): Promise<Media> {
	// local: true = a file on this server, 'url' = a plain https link (RD's original file), else a
	// path on Whatbox
	const input = local ? ['-i', path] : ['-headers', `Cookie: ${await files()}\r\n`, fileUrl(path)];
	const info = JSON.parse(await run('ffprobe', [
		'-v',
		'error',
		'-show_entries',
		'stream=index,codec_type,codec_name,height,pix_fmt,disposition:stream_tags=language,title:format=duration,bit_rate'
		+ ':chapter=start_time,end_time:chapter_tags=title',
		'-of',
		'json',
		...input,
	])) as ProbeInfo;
	const token = tokenOf({
		path,
		local,
	});
	const st = info.streams, v = st.find(s => s.codec_type === 'video');
	const file = path.split('/').pop() ?? path;
	const of = (type: string) => st.filter(s => s.codec_type === type);
	// same shape as RD media infos, plus what the page's decoder needs (stream index, codec)
	return {
		file,
		wb: `/api/file/${token}/${encodeURIComponent(file)}`,
		duration: +info.format.duration,
		audio: of('audio').map(s => ({
			id: `a${s.index}`,
			index: s.index,
			codec: s.codec_name,
			...label(s),
		})),
		subs: of('subtitle').map(s => ({
			id: `s${s.index}`,
			index: s.index,
			codec: s.codec_name,
			image: IMAGE_SUBS.test(s.codec_name),
			...label(s),
		})),
		video: videoOf(v),
		bitrate: +(info.format.bit_rate ?? 0) || 0,
		res: resOfHeight(v?.height),
		outro: outroIn(info.chapters, +info.format.duration),
	};
}

// a ranged read of a file on this server (the player reads it in pieces)
export async function sendRange(
	req: IncomingMessage,
	res: ServerResponse,
	file: string,
	type: string,
	cache = 'no-store',
) {
	const size = (await fs.promises.stat(file)).size;
	const r = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
	const start = r ? +(r[1] ?? 0) || 0 : 0, end = r?.[2] ? Math.min(+r[2], size - 1) : size - 1;
	res.writeHead(r ? 206 : 200, {
		'content-type': type,
		'accept-ranges': 'bytes',
		'content-length': end - start + 1,
		'cache-control': cache,
		...(r && { 'content-range': `bytes ${start}-${end}/${size}` }),
	});
	if (req.method === 'HEAD') return res.end();
	fs.createReadStream(file, {
		start,
		end,
	}).on('error', () => res.end()).pipe(res);
}

// --- byte relay: the page's own decoder fetches the file through here. No conversion: bytes pass
// through as-is, Range requests included (seeking). Only the login cookie stays server-side.
export async function relay(req: IncomingMessage, u: URL, res: ServerResponse) {
	const m = fromToken(decodeURIComponent(u.pathname.split('/')[3] || ''));
	if (!m) return res.writeHead(404).end();
	if (m.local === true) return sendRange(req, res, m.path, 'video/x-matroska'); // a file on this server
	// node:https, not fetch: undici asserts and kills the process when a paused body's socket
	// closes (the player throttles reads)
	const range: Record<string, string> = req.headers.range ? { Range: req.headers.range } : {};
	const get = async () => {
		const url = m.local === 'url' ? m.path : fileUrl(m.path);
		const headers = m.local === 'url' ? range : {
			...range,
			Cookie: await files(),
		};
		return new Promise<IncomingMessage>((ok, ko) => {
			const up = https.get(url, { headers }, ok).on('error', ko);
			res.on('close', () => up.destroy());
		});
	};
	let r = await get().catch(() => null);
	if (r?.statusCode && r.statusCode >= 300 && r.statusCode < 400) { // session expired: log in again
		r.resume();
		if (m.local !== 'url') cookie = null;
		r = await get().catch(() => null);
	}
	if (!r) return res.writeHead(502).end();
	pipeUp(req, r, res);
}

function pipeUp(req: IncomingMessage, r: IncomingMessage, res: ServerResponse) {
	const h: OutgoingHttpHeaders = {
		'cache-control': 'no-store',
		'content-type': 'video/x-matroska',
	};
	for (const k of ['content-length', 'content-range', 'accept-ranges']) {
		if (r.headers[k]) h[k] = r.headers[k];
	}
	res.writeHead(r.statusCode ?? 502, h);
	if (req.method === 'HEAD') {
		r.destroy();
		return res.end();
	}
	// throughput of each relayed range: tells a slow link (Wi-Fi, RD) from a slow decoder when a
	// device stutters
	const t0 = Date.now();
	let sent = 0;
	r.on('data', (d: Buffer) => sent += d.length);
	res.on('close', () => {
		const secs = (Date.now() - t0) / 1000;
		const mb = (sent / 1e6).toFixed(0), rate = (sent / 1e6 / secs).toFixed(1);
		const what = `${mb} MB in ${secs.toFixed(0)} s = ${rate} MB/s`;
		if (sent > 20e6 || secs > 20) console.log(`relay ${req.headers.range || 'all'}: ${what}`);
	});
	r.on('error', () => res.destroy()).pipe(res);
}
