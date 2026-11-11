// Sources of a title: a Stremio stream addon (Torrentio + Real-Debrid by default), a Torznab
// indexer through qBittorrent, and the household's own library (Jellyfin's folders,
// qBittorrent's finished torrents).
import crypto from 'node:crypto';
import fs from 'node:fs';

import { msg } from '@lingui/core/macro';

import type {
	MediaTrack,
	Stream,
	StreamsQuery,
} from '@player1/shared/api';
import {
	LANGS as SPOKEN,
	resOf,
	seedsOf,
	tagStream,
} from '@player1/shared/langs';

import { db } from './db.ts';
import type {
	GetHandlers,
	RawQuery,
} from './http.ts';
import { UserError } from './i18n.ts';
import {
	type Media,
	probe,
	qbit,
	qbOn,
	type QbTorrent,
	SEEDBOX,
} from './qbit.ts';
import {
	norm,
	type TmdbTitle,
	yearOf,
} from './titles.ts';
import {
	epRe,
	fitsEp,
	parseTorznab,
} from './torznab.ts';
import {
	fresh,
	getJSON,
	hasTmdb,
	memo,
	rd,
	tmdb,
	warn,
} from './upstream.ts';

const { RD_TOKEN = '', TORZNAB_URL = '', TORZNAB_KEY = '' } = process.env;
// default: Torrentio with Real-Debrid, favouring releases in the languages the household's
// presets speak
const ADDON = () => {
	const langs = new Set(db.profiles.flatMap(p => p.presets.flatMap(x => x.langs
		.map(l => SPOKEN[l.code]?.torrentio)).filter(Boolean)));
	return process.env.STREAM_ADDON || `https://torrentio.strem.fun/providers=yts,eztv,rarbg,1337x,thepiratebay,kickasstorrents,torrentgalaxy,magnetdl,horriblesubs,nyaasi,tokyotosho,anidex,torrent9|language=${[...langs].join(',')}|qualityfilter=threed,scr,cam|realdebrid=${RD_TOKEN}`;
};

interface AddonStream { name?: string; title?: string; url: string }

export const streamsFor = (q: StreamsQuery) => memo(`s:${q.imdb}:${q.s}:${q.e}`, async () => {
	const id = q.type === 'series' ? `${q.imdb}:${q.s}:${q.e}` : q.imdb;
	const indexer = TORZNAB_URL && qbOn
		? tzSearch(q).catch((err: unknown) => warn('indexer search')(err) ?? [])
		: [];
	const [{ streams = [] }, c4] = await Promise.all([
		getJSON<{ streams?: AddonStream[] }>(`${ADDON()}/stream/${q.type}/${id}.json`),
		indexer,
	]);
	return [...streams.map((st): Stream => ({
		name: st.name ?? '',
		title: st.title ?? '',
		url: st.url,
		cached: /\[RD\+\]/.test(st.name || ''),
		tag: tagStream(st.title || ''),
		res: resOf(st.name || ''),
		seeds: seedsOf(st.title),
	})), ...c4];
});

interface RdTracks { [id: string]: { lang_iso?: string; lang?: string } }
interface RdMediaInfos {
	modelUrl?: string;
	duration?: number;
	availableFormats?: Record<string, string>;
	availableQualities?: Record<string, string>;
	details?: { audio?: RdTracks; subtitles?: RdTracks };
}
const tracks = (o: RdTracks = {}): MediaTrack[] => Object.entries(o).map(([id, t]) => ({
	id,
	iso: t.lang_iso,
	label: t.lang || t.lang_iso,
}));
// addon resolve URL -> RD download link -> RD file id -> media infos (tracks + HLS url template)
export const resolve = (url: string) => memo(`r:${url}`, async () => {
	const r = await fetch(url, { redirect: 'manual' });
	const link = r.headers.get('location');
	if (!link || !/real-debrid\.com\/d\//.test(link)) {
		throw new UserError(msg`This source isn’t ready on Real-Debrid yet`);
	}
	return fromLink(link);
});
interface RdLink { id: string; filename: string; download: string }
const fromLink = (link: string) => memo(`l:${link}`, async (): Promise<Media> => {
	const un = await rd<RdLink>('/unrestrict/link', { link });
	const info = await rd<RdMediaInfos>(`/streaming/mediaInfos/${un.id}`).catch(() => null);
	return {
		file: un.filename,
		direct: un.download,
		model: info?.modelUrl,
		duration: info?.duration,
		formats: info?.availableFormats,
		qualities: info?.availableQualities,
		audio: tracks(info?.details?.audio),
		subs: tracks(info?.details?.subtitles),
	};
});

// --- Torznab indexer (a private tracker such as C411, or Prowlarr/Jackett in front of several).
// RD gets no peers for private torrents, so after the user agrees qBittorrent downloads (and
// keeps seeding) the release, and qbit.ts streams it. Release urls: "tz:<infohash>" ("c411:"
// from older versions still works).
const indexerName = (url: string) => {
	if (!url) return '';
	if (/c411\.org/.test(url)) return 'C411';
	return new URL(url).hostname.split('.').at(-2)?.replace(/^./, c => c.toUpperCase()) || 'Indexer';
};
export const INDEXER = indexerName(TORZNAB_URL);
export const isTz = (u?: string) => /^(tz|c411):/.test(u || '');
export const tzHash = (u: string) => u.slice(u.indexOf(':') + 1);
// "tz:<hash>" -> download link (holds the API key: never sent to clients)
const tzDl = new Map<string, string>();
const size = (n: number) => n > 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.round(n / 1e6)} MB`;
async function tzSearch({ type, imdb, s, e }: StreamsQuery): Promise<Stream[]> {
	const p = new URLSearchParams({
		apikey: TORZNAB_KEY,
		t: type === 'series' ? 'tvsearch' : 'movie',
		imdbid: imdb,
		limit: '100',
	});
	if (type === 'series') p.set('season', String(s));
	const r = await fetch(`${TORZNAB_URL}?${p}`);
	if (!r.ok) throw new Error(`${INDEXER} ${r.status}`);
	return parseTorznab(await r.text())
		.filter(x => x.download && x.seeders > 0
			&& (type !== 'series' || fitsEp(x.title, Number(s), Number(e))))
		.map(x => {
			const url = 'tz:' + (x.hash || crypto.createHash('sha1').update(x.guid || x.download).digest('hex'));
			tzDl.set(url, x.download);
			return {
				name: INDEXER,
				title: `${x.title}\n💾 ${size(x.size)} 👤 ${x.seeders}`,
				url,
				cached: false,
				tz: true,
				tag: tagStream(x.title),
				res: resOf(x.title),
				seeds: x.seeders,
				info: {
					title: x.title,
					size: x.size,
					seeders: x.seeders,
					leechers: x.leechers,
					grabs: x.grabs,
					date: x.date,
					details: x.details,
					free: x.free,
				},
			};
		});
}
// the .torrent of a release (its link holds the API key: fetched here, never sent to clients)
export const tzTorrent = (url: string) => async () => {
	const dl = tzDl.get(url.replace(/^c411:/, 'tz:'));
	if (!dl) throw new UserError(msg`This version is no longer listed. Search again.`);
	const r = await fetch(dl);
	if (!r.ok) throw new Error(`${INDEXER} ${r.status}`);
	return Buffer.from(await r.arrayBuffer());
};

// qBittorrent as a library: finished torrents whose name starts with one of the title's names
// (French, English, original), plus the year for a film or the episode/season for a series. They
// play at once, nothing to download.
interface TmdbFind { movie_results: TmdbTitle[]; tv_results: TmdbTitle[] }
export const namesOf = (imdb: string) => memo(`n:${imdb}`, async () => {
	const [fr, en] = await Promise.all([
		tmdb<TmdbFind>(`/find/${imdb}`, {
			external_source: 'imdb_id',
			language: 'fr-FR',
		}),
		tmdb<TmdbFind>(`/find/${imdb}`, {
			external_source: 'imdb_id',
			language: 'en-US',
		}),
	]);
	const r = [...fr.movie_results, ...fr.tv_results][0];
	const e = [...en.movie_results, ...en.tv_results][0];
	if (!r) return undefined;
	const all = [r.title, r.name, r.original_title, r.original_name, e?.title, e?.name];
	return {
		titles: [...new Set(all.filter(x => x).map(norm))].filter(x => x.length > 2),
		year: yearOf(r),
	};
});
// ffprobe once per file
export const wbInfo = (path: string, local?: boolean | 'url') => {
	return memo(`wm:${local ? 'l' : 'r'}:${path}`, () => probe(path, local));
};
// the Jellyfin library, read straight from its folders as this server sees them (MEDIA_DIR: same
// disk, NFS…): films by file or folder name + year, series by show folder + SxxEyy. Same
// file-name rule as qBittorrent; no Jellyfin key needed.
export const MEDIA = (process.env.MEDIA_DIR || '').replace(/\/$/, '');
const VIDEO = /\.(mkv|mp4|m4v|avi|webm)$/i;
const readAll = async () => {
	if (!MEDIA) return [];
	return fs.promises.readdir(MEDIA, { recursive: true }).catch((): string[] => []);
};
export const mediaFiles = () => fresh('media', async () => (await readAll())
	.filter(f => VIDEO.test(f) && !/sample/i.test(f)));
// Jellyfin + qBittorrent, a file present in both listed once (Jellyfin: same network)
export const libAll = async (q: StreamsQuery) => {
	const jf = await localFor(q), wb = await libraryFor(q);
	const key = (t: string) => norm(t.replace(VIDEO, ''));
	return [...jf, ...wb.filter(w => !jf.some(j => key(j.title) === key(w.title)))];
};

// Player1's own downloads: player1/films is a movies folder
const partsOf = (f: string) => {
	const parts = f.split('/');
	if (parts[0] !== 'player1') return parts;
	return parts.slice(1).map((x, i) => i || x !== 'films' ? x : 'movies');
};
async function localFor({ type, imdb, s, e }: StreamsQuery): Promise<Stream[]> {
	if (!hasTmdb || !imdb) return [];
	const n = await namesOf(imdb).catch(() => null);
	if (!n) return [];
	const starts = (x?: string) => n.titles.some(t => norm(x).startsWith(t)), ep = epRe(s, e);
	const hits = (await mediaFiles()).filter(f => {
		const parts = partsOf(f), base = parts.at(-1) ?? '';
		const tagged = f.includes(`[imdbid-${imdb}]`); // downloads carry the IMDb id: an exact match
		if (type === 'series') {
			return parts[0] === 'series' && (tagged || starts(parts[1])) && ep.test(base);
		}
		const named = parts.slice(1).some(starts) && (!n.year || f.includes(n.year));
		return parts[0] === 'movies' && (tagged || named);
	});
	return Promise.all(hits.map(async f => {
		const base = f.split('/').pop() ?? f;
		return {
			name: 'Jellyfin',
			title: base,
			url: 'jf:' + f,
			cached: false,
			lib: true,
			tag: tagStream(base),
			res: resOf(base),
			seeds: 0,
			info: {
				title: base,
				size: (await fs.promises.stat(`${MEDIA}/${f}`).catch(() => null))?.size,
			},
		};
	}));
}
async function libraryFor({ type, imdb, s, e }: StreamsQuery): Promise<Stream[]> {
	if (!qbOn || !hasTmdb || !imdb) return [];
	const n = await namesOf(imdb).catch(() => null);
	if (!n) return [];
	const all = await fresh('qball', () => qbit<QbTorrent[]>('/torrents/info'))
		.catch((err: unknown) => warn('qBittorrent library')(err) ?? []);
	return all.filter(t => t.progress === 1 && n.titles.some(x => norm(t.name).startsWith(x))
		&& (type === 'series' ? fitsEp(t.name, Number(s), Number(e)) : !n.year || t.name.includes(n.year)))
		.map(t => ({
			name: SEEDBOX,
			title: t.name,
			url: 'wb:' + t.hash,
			cached: false,
			lib: true,
			tag: tagStream(t.name),
			res: resOf(t.name),
			seeds: 0,
			info: {
				title: t.name,
				size: t.size,
			},
		}));
}

// external subtitles (OpenSubtitles via its Stremio addon, no key): a few versions in each
// language asked for
interface OsSub { lang: string; url: string }
export const extSubs = async ({ type, imdb, s, e }: StreamsQuery, codes: string[]) => {
	const id = type === 'series' ? `${imdb}:${s}:${e}` : imdb;
	const { subtitles = [] } = await memo(`x:${imdb}:${s}:${e}`, () => getJSON<{ subtitles?: OsSub[] }>(`https://opensubtitles-v3.strem.io/subtitles/${type}/${id}.json`)
		.catch((): { subtitles?: OsSub[] } => ({})));
	return codes.flatMap(code => {
		const l = SPOKEN[code];
		if (!l) return [];
		return subtitles.filter(x => l.iso.includes(x.lang)).slice(0, 3).map((x, i): MediaTrack => ({
			id: `ext-${code}${i + 1}`,
			code,
			iso: l.iso[0],
			label: l.name,
			ext: true,
			url: x.url,
		}));
	});
};

// the address gives the episode as text
const queryOf = (q: RawQuery<StreamsQuery>): StreamsQuery => ({
	type: q.type === 'series' ? 'series' : 'movie',
	imdb: q.imdb ?? '',
	s: q.s ? Number(q.s) : undefined,
	e: q.e ? Number(q.e) : undefined,
});
export const sourceGets: GetHandlers = {
	streams: async raw => {
		const q = queryOf(raw);
		return [...await libAll(q), ...await streamsFor(q)];
	},
};
