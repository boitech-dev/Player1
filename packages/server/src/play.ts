// Playback: which source and tracks fit the profile's preset, what the device decodes itself, the
// indexer release offered before a download, and the next episode resolved ahead of time.
import { msg } from '@lingui/core/macro';

import type {
	Account,
	MediaTrack,
	Offer,
	Pending,
	PendingInfo,
	PlayBody,
	Playing,
	PlayReply,
	Release,
	Stream,
	StreamsQuery,
} from '@player1/shared/api';
import {
	candidates,
	pickTracks,
	type Tier,
	tierAlone,
	tiersOf,
	type TrackPick,
} from '@player1/shared/langs';
import {
	canName,
	hwDecodes,
} from '@player1/shared/release';

import { activePreset } from './db.ts';
import type { PostHandlers } from './http.ts';
import {
	lang,
	UserError,
} from './i18n.ts';
import {
	type Media,
	type QbGot,
	qbit,
	qbOn,
	qbTorrent,
} from './qbit.ts';
import {
	extSubs,
	INDEXER,
	isTz,
	libAll,
	MEDIA,
	mediaFiles,
	resolve,
	streamsFor,
	tzHash,
	tzTorrent,
	wbInfo,
} from './sources.ts';
import { IMG } from './titles.ts';
import {
	errMsg,
	fresh,
	getJSON,
	hasTmdb,
	memo,
	tmdb,
	warn,
} from './upstream.ts';

/** a source as play() holds it: a listed stream, or only the address a device chose */
type Src = Partial<Stream> & { url: string };

// --- shown before an indexer download: account ratio (C411 tells it) and the free space
// qBittorrent reports ---
interface C411Profile {
	transfer?: { uploaded: { total: number }; downloaded: { total: number } };
	download?: { allowed?: boolean; blockedReason?: string };
}
interface QbMain { server_state?: { free_space_on_disk?: number } }
const c411 = () => fresh('c411p', () => getJSON<C411Profile>('https://c411.org/api/user/profile', { headers: { Authorization: `Bearer ${process.env.TORZNAB_KEY}` } })).catch(warn('C411 profile'));
const maindata = () => qbit<QbMain>('/sync/maindata');
const qbFree = () => fresh('qbfree', () => maindata().catch(maindata)).catch(warn('qBittorrent'));
// the ratio now, and once this download (extra bytes) is done
const ratios = (up?: number, down?: number, extra = 0) => up && down ? {
	ratio: up / down,
	after: up / (down + extra),
} : {
	ratio: null,
	after: null,
};
const tracker = (p: C411Profile | undefined, extra: number) => {
	const up = p?.transfer?.uploaded.total, down = p?.transfer?.downloaded.total;
	return {
		up,
		down,
		...ratios(up, down, extra),
		allowed: p?.download?.allowed ?? true,
		blocked: p?.download?.blockedReason,
	};
};
async function account(size?: number, free?: boolean): Promise<Account> {
	const [p, wb] = await Promise.all([
		INDEXER === 'C411' ? c411() : undefined,
		qbOn ? qbFree() : undefined,
	]);
	return {
		...tracker(p, free ? 0 : size || 0),
		disk: wb?.server_state?.free_space_on_disk ?? null,
	};
}

// one indexer release as the sheet shows it, plus the other releases of this title to pick from
// instead
const release = (st: Stream): Release => ({
	url: st.url,
	tag: st.tag,
	res: st.res,
	src: st.name,
	...st.info,
	title: st.info?.title ?? st.title,
});
async function offer(
	st: Stream,
	tier: Tier | null,
	streams: Stream[],
	lib: Stream[] = [],
): Promise<Offer> {
	const inLib = (x: Stream) => lib.some(l => l.url.slice(3) === tzHash(x.url));
	// the same advertised languages first
	const tag = JSON.stringify(st.tag);
	const sameTag = (x: Stream) => Number(JSON.stringify(x.tag) === tag);
	const others = streams.filter(x => x.tz && x.url !== st.url && !inLib(x))
		.sort((a, b) => sameTag(b) - sameTag(a) || b.res - a.res || b.seeds - a.seeds);
	return {
		...release(st),
		tier,
		account: await account(st.info?.size, st.info?.free),
		library: lib.map(release),
		others: others.slice(0, 12).map(release),
	};
}

// --- quality: the device's preferred source resolution (closest wins), absent = highest
// available. An indexer release qBittorrent doesn't hold yet is never fetched without asking:
// play answers { confirm, fallback } instead, and once confirmed (confirm=1) { pending } until
// qBittorrent has it. Indexer files are decoded by the viewing device: hw = the formats its
// graphics chip decodes ("hevc,av1"), H.264 everywhere ---
interface Ctx {
	b: PlayBody;
	q: StreamsQuery;
	hw: string;
	/** the title's original language */
	orig?: string | null;
	pref: number;
	streams: Stream[];
	lib: Stream[];
	ext: MediaTrack[];
	/** what RD has ready, AV1 left out: RD lists qualities for some AV1 files but never delivers a
	 * segment */
	auto: Stream[];
	tried: Set<string>;
	/** the first indexer release that would fit, if nothing ready does */
	ask?: Promise<Offer>;
}

const extOf = (c: Ctx, tier: Tier) => c.ext.filter(x => x.code === tier.split(':')[1]);
const tierPick = (c: Ctx, tier: Tier, r: Media) => tier.startsWith('ext:')
	? pickTracks(tier.replace('ext:', 'sub:'), r.audio, extOf(c, tier), c.orig)
	: pickTracks(tier, r.audio, r.subs, c.orig);
const out = (c: Ctx, r: Media, st: Src, tier: Tier | null, pick: TrackPick | null): Playing => ({
	...r,
	subs: [...r.subs, ...c.ext],
	tier: tier?.replace('ext:', 'sub:'),
	pick,
	res: st.res ?? r.res ?? 0,
	source: st.title,
	url: st.url,
});
// chosen by hand: still choose the tracks that best fit the preset
const byHand = (c: Ctx, tiers: Tier[], r: Media, st: Src) => {
	for (const tier of tiers) {
		const pick = tierPick(c, tier, r);
		if (pick) return out(c, r, st, tier, pick);
	}
	return out(c, r, st, null, null);
};
const decodes = (c: Ctx, st: Stream) => canName(st.title, st.res, c.hw);
// RD's transcoder can't read AV1, and a file whose only quality is 'full' won't play at all:
// skip both
const playable = (r: Media) => Object.values(r.qualities || {}).some(q => q !== 'full');
const wbGet = (c: Ctx, st: Src, start: boolean) => qbTorrent(
	tzHash(st.url),
	c.q,
	start && tzTorrent(st.url),
);
const waitFor = (got: { pending: PendingInfo }, st: Src): Pending => ({
	...got,
	url: st.url,
	source: st.info?.title || st.title,
});
// media infos of a library file, or { pending } while qBittorrent still fetches it
async function fromLib(c: Ctx, st: Src): Promise<Media | { pending: PendingInfo }> {
	const file = st.url.slice(3);
	if (st.url.startsWith('jf:')) {
		if (!(await mediaFiles()).includes(file)) throw new UserError(msg`This file is no longer in Jellyfin.`);
		return wbInfo(`${MEDIA}/${file}`, true);
	}
	const got = await qbTorrent(file, c.q);
	if (!got) throw new UserError(msg`This file is no longer in qBittorrent.`);
	return 'pending' in got ? got : wbInfo(got.path, got.local);
}
// a fit, unless an indexer release was found first: then it is what plays while that downloads
async function found(c: Ctx, r: Media, st: Src, tier: Tier, pick: TrackPick): Promise<PlayReply> {
	const playing = out(c, r, st, tier, pick);
	return c.ask ? {
		confirm: await c.ask,
		fallback: playing,
	} : playing;
}

// a source the device picked
async function chosen(c: Ctx, tiers: Tier[], url: string): Promise<PlayReply> {
	if (/^(wb|jf):/.test(url)) { // a file already in the library
		const st = c.lib.find(x => x.url === url) ?? {
			url,
			title: url.slice(3),
		};
		const r = await fromLib(c, st);
		return 'pending' in r ? waitFor(r, st) : byHand(c, tiers, r, st);
	}
	if (isTz(url)) {
		const st = c.streams.find(x => tzHash(x.url) === tzHash(url) && x.tz);
		if (!st) throw new UserError(msg`This version is no longer listed. Search again.`);
		const got = await wbGet(c, st, !!c.b.confirm);
		if (!got) return {
			confirm: await offer(st, null, c.streams, c.lib),
			fallback: null,
		};
		if ('pending' in got) return waitFor(got, st);
		return byHand(c, tiers, await wbInfo(got.path, got.local), st);
	}
	const st = c.streams.find(x => x.cached && x.url === url) ?? { url };
	return byHand(c, tiers, await resolve(url), st);
}

// your library first (Jellyfin, qBittorrent): original quality, tracks read from the file itself;
// video this device decodes in hardware
async function fromLibrary(c: Ctx, tier: Tier) {
	const ranked = candidates(c.lib.filter(x => decodes(c, x)), tier, c.pref, c.orig);
	for (const st of ranked.filter(x => !c.tried.has(tier + x.url)).slice(0, 3)) {
		c.tried.add(tier + st.url);
		const r = await fromLib(c, st).catch(warn('library'));
		if (!r || 'pending' in r || !hwDecodes(r.video, c.hw) || !netFits(r, c.b.net)) continue;
		const pick = tierPick(c, tier, r);
		if (pick) return found(c, r, st, tier, pick);
	}
}

// a device that decodes files itself tries releases its hardware handles first (no live
// transcoder to wait on)
async function fromRd(c: Ctx, tier: Tier) {
	const ranked = candidates(c.auto, tier, c.pref, c.orig);
	if (c.b.direct) ranked.sort((a, b) => Number(decodes(c, b)) - Number(decodes(c, a)));
	// 4 playable files per tier; files RD can't stream (4K remuxes: 'full' only) don't count, 12
	// looked at at most
	let tries = 0;
	for (const st of ranked.filter(x => !c.tried.has(tier + x.url)).slice(0, 12)) {
		c.tried.add(tier + st.url);
		try {
			const r = await resolve(st.url);
			if (!playable(r)) continue;
			const pick = tierPick(c, tier, r);
			if (pick) return await found(c, r, st, tier, pick);
		} catch (err) {
			console.warn('resolve failed', errMsg(err));
		}
		if (++tries >= 4) break;
	}
}

// indexer releases by name only (tracks are only known once downloaded): exact VF / VOSTFR tags,
// video this device decodes in hardware (only releases that name the language they bring)
async function fromIndexer(c: Ctx, tier: Tier) {
	const [kind, code = ''] = tier.split(':');
	if (c.ask || code === 'orig') return;
	const says = (x: Stream) => kind === 'dub'
		? x.tag.a.includes(code)
		: kind === 'sub' && x.tag.s.includes(code);
	const fit = c.streams.filter(x => x.tz && says(x) && decodes(c, x));
	const ranked = candidates(fit, tier, c.pref, c.orig);
	for (const st of ranked.slice(0, 5)) {
		// already fetched: plays at once
		const got: QbGot | null | undefined = await wbGet(c, st, false).catch(warn('qBittorrent'));
		if (got && 'pending' in got) return waitFor(got, st);
		if (got?.path) {
			const r = await wbInfo(got.path, got.local), pick = tierPick(c, tier, r);
			if (pick) return out(c, r, st, tier, pick);
		}
		c.ask ||= offer(st, tier, c.streams, c.lib);
	}
}

async function automatic(c: Ctx, tiers: Tier[]): Promise<PlayReply> {
	for (const tier of tiers) {
		if (tier.startsWith('ext:') && !extOf(c, tier).length) continue;
		const hit = await fromLibrary(c, tier) ?? await fromRd(c, tier) ?? await fromIndexer(c, tier);
		if (hit) return hit;
	}
	const best = c.auto[0];
	if (c.ask) return {
		confirm: await c.ask,
		fallback: best ? out(c, await resolve(best.url), best, null, null) : null,
	};
	if (!best) throw new UserError(msg`Real-Debrid has no source ready for this title.`);
	return out(c, await resolve(best.url), best, null, null); // best effort: the UI says the language isn't verified
}

export async function play(b: PlayBody): Promise<PlayReply> {
	const { type, imdb, s, e, url, tier: only } = b;
	// a tier forced for this title, else the profile's preset
	const tiers = only ? tierAlone(only) : tiersOf(activePreset().langs);
	const q = {
			type,
			imdb,
			s,
			e,
		}, streams = await streamsFor(q);
	const ext = await extSubs(q, [...new Set([...activePreset().langs.map(l => l.code), 'en'])]);
	const c: Ctx = {
		b,
		q,
		hw: b.hw ?? '',
		orig: b.lang,
		pref: Number(b.quality) || 0,
		streams,
		ext,
		lib: await libAll(q), // Jellyfin (LAN) first, then qBittorrent
		auto: streams.filter(x => x.cached && !/\bAV1\b/i.test(x.title)),
		tried: new Set(),
	};
	return url ? chosen(c, tiers, url) : automatic(c, tiers);
}

// the device's measured link to here, with margin
const netFits = (m: { bitrate?: number } | undefined, net?: number) => !Number(net)
	|| !(m?.bitrate !== undefined && m.bitrate > Number(net) * 0.7e6);
type Original = Playing & { model: string; direct: string };
const original = (r: PlayReply): r is Original => 'audio' in r && !!r.model && !!r.direct && !r.wb;

function devicePick(r: Playing, m: Media, b: PlayBody, ext: MediaTrack[]): TrackPick | null {
	const sub = r.pick?.sub ?? '', first = m.audio[0];
	if (sub.startsWith('ext-') && r.tier) {
		const pick = pickTracks(r.tier, m.audio, ext.filter(x => x.id === sub), b.lang);
		return pick && {
			...pick,
			sub,
		};
	}
	if (r.tier) return pickTracks(r.tier, m.audio, m.subs, b.lang);
	return first ? {
		audio: first.id,
		sub: 'none',
	} : null;
}

// RD's live transcoder can fall behind real time (the picture pauses every few seconds). A device
// that decodes the video itself gets RD's original file instead, relayed byte for byte (RD sends
// no CORS headers). Nothing is converted anywhere; the transcoder stays as the fallback (r.rd) if
// the device's decoder fails. b.hw = the formats the device measured itself playing well (h264,
// hevc10, 4k, av1), its own overrides applied
async function device(r: PlayReply, b: PlayBody): Promise<PlayReply> {
	if (!b.direct || !original(r)) return r;
	if (!canName(r.source || r.file || '', r.res, b.hw)) return r; // quick name check before probing
	const m = await wbInfo(r.direct, 'url').catch(warn('direct probe'));
	if (!m?.audio.length) return r;
	// what the file really is (10-bit, 4K, bitrate) against what the device measured
	if (!hwDecodes(m.video, b.hw) || !netFits(m, b.net)) return r;
	const ext = r.subs.filter(x => x.ext), pick = devicePick(r, m, b, ext);
	if (!pick) return r;
	return {
		...r,
		model: undefined,
		wb: m.wb,
		video: m.video,
		duration: m.duration || r.duration,
		audio: m.audio,
		subs: [...m.subs, ...ext],
		pick,
		rd: {
			model: r.model,
			audio: r.audio,
			subs: r.subs,
			pick: r.pick,
		},
	};
}

// --- series: the episode after this one (next in the season, else E1 of the next season),
// resolved ahead of time ---
interface TmdbShow { seasons: { season_number: number; episode_count: number }[] }
interface TmdbSeason {
	episodes?: { episode_number: number; name?: string; still_path?: string | null }[];
}
// request key -> play() promise
const ahead = new Map<string, Promise<PlayReply>>();
const aheadKey = (b: PlayBody) => JSON.stringify([
	b.imdb,
	Number(b.s),
	Number(b.e),
	b.tier || activePreset().langs,
	b.hw || '',
	b.quality || 0,
	b.lang || '',
]);
function nextEp(show: TmdbShow, s: number, e: number) {
	const seasons = show.seasons.filter(x => x.season_number > 0 && x.episode_count > 0);
	const here = seasons.find(x => x.season_number === s);
	const later = seasons.find(x => x.season_number > s);
	if (here && e < here.episode_count) return {
		s,
		e: e + 1,
	};
	return later && {
		s: later.season_number,
		e: 1,
	};
}
async function nextOf(id: string | undefined, s = 0, e = 0) {
	if (!hasTmdb || !id?.startsWith('tmdb:')) return null;
	const show = await memo(`tv:${id}`, () => tmdb<TmdbShow>(`/tv/${id.slice(5)}`));
	const n = nextEp(show, Number(s), Number(e));
	if (!n) return null;
	const where = `/tv/${id.slice(5)}/season/${n.s}`;
	const season = await memo(`season:${id}:${n.s}:${lang()}`, () => tmdb<TmdbSeason>(where))
		.catch(() => null);
	const ep = season?.episodes?.find(x => x.episode_number === n.e);
	return {
		...n,
		name: ep?.name,
		still: ep?.still_path ? IMG + 'original' + ep.still_path : undefined,
	};
}
// pre-load the next one: sources, RD link, tracks. Never starts an indexer download.
function preload(b: PlayBody, next: { s: number; e: number }) {
	const nb = {
		...b,
		s: next.s,
		e: next.e,
		url: undefined,
		confirm: undefined,
	};
	if (ahead.has(aheadKey(nb))) return;
	const p = play(nb).then(x => device(x, nb));
	p.catch(warn('preload'));
	ahead.set(aheadKey(nb), p);
	setTimeout(() => ahead.delete(aheadKey(nb)), 3 * 3600e3);
}

export const playPosts: PostHandlers = {
	play: async b => {
		// an episode pre-resolved while the previous one played starts at once
		const pre = !b.url && !b.confirm && ahead.get(aheadKey(b));
		ahead.delete(aheadKey(b));
		const r = await device(pre ? await pre.catch(() => play(b)) : await play(b), b);
		if (b.type === 'series' && 'audio' in r) {
			r.next = await nextOf(b.id, b.s, b.e).catch(() => null);
			if (r.next) preload(b, r.next);
		}
		return r;
	},
};
