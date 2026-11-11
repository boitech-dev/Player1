import { t } from '@lingui/core/macro';
import type HlsType from 'hls.js';
import type {
	FragmentLoaderConstructor,
	LoaderCallbacks,
	LoaderConfiguration,
	LoaderContext,
} from 'hls.js';

import type {
	Confirm,
	MediaTrack,
	PlayBody,
	Playing,
	PlayReply,
	PlayRequest,
} from '@player1/shared/api';
import { tierTag } from '@player1/shared/langs';
import {
	type Format,
	FORMATS,
	RES_LABEL,
} from '@player1/shared/release';

import {
	app,
	currentPreset,
	names,
	presetSays,
	setApp,
} from '../app/state.ts';
import { post } from '../lib/api.ts';
import {
	CAPS_VERSION,
	directOn,
	FORMAT_NAME,
	getCaps,
	hwList,
	me,
	preferredQuality,
	setCaps,
} from '../lib/device.ts';
import {
	episodeName,
	hms,
} from '../lib/format.ts';
import { dec } from '../lib/i18n.ts';
import {
	keep,
	load,
} from '../lib/store.ts';
import { tierSays } from '../lib/tiers.ts';
import { sheetOpen } from '../ui/sheet.tsx';
import { toast } from '../ui/toast.tsx';
import { runBench } from './bench.ts';
import {
	type MoviElement,
	moviReady,
	newMovi,
} from './movi.ts';
import {
	type Media,
	type NativeCue,
	nativeOn,
	nv,
} from './native.ts';
import {
	type Cue,
	cueAt,
	parseSrt,
} from './srt.ts';

// The player: one engine for the whole page, driven by the play page and the remote. It finds a
// source (POST /api/play), plays it with the right player and keeps watch:
// - Real-Debrid's transcoder (HLS, hls.js or the browser's own), audio and subtitles baked in
// - a file the device decodes itself (Movi in a browser, Android's player in the TV app): RD's
//   original, a qBittorrent or Jellyfin file, through the server's byte relay
// Progress is saved as it plays; a series' next episode starts by itself at the end.

/** a playing file, its tracks named for the screen */
export interface Live extends Playing {
	audio: Named[];
	subs: Named[];
}

export interface Named extends MediaTrack {
	name: string;
}

export interface Wait {
	msg: string;
	sub: string;
	/** the lamp beam: still looking */
	spin: boolean;
}

/** what the player shows, rebuilt after every change */
export interface PlayerView {
	open: boolean;
	idle: boolean;
	title: string;
	info: string;
	art?: string;
	wait: Wait | null;
	paused: boolean;
	now: number;
	total: number;
	/** "Start over" while a resumed film plays */
	restart: boolean;
	live: Live | null;
	sel: { audio: string; sub: string };
	next: { name: string; countdown: number | null } | null;
	cue: string;
	imgCues: NativeCue[];
	/** the TV app's player is on: the page clears its backgrounds */
	native: boolean;
	delay: number;
}

// --- state ---

let video: HTMLVideoElement | null = null;
let moviHost: HTMLElement | null = null;
let movi: MoviElement | null = null;
let v: Media | null = null;
let hls: HlsType | null = null;

let req: PlayRequest | null = null;
let live: Live | null = null;
let sel = {
	audio: '',
	sub: 'none',
};
let open = false;
let idle = false;
let wait: Wait | null = null;
let info = '';
let restart = false;

// RD's transcoder only produces segments in order, so a far seek restarts the stream at that time
// with ?t= (undocumented). base = where the current stream starts in the file. reach = furthest
// point played; the transcoder runs ahead of it, so reach+60s is safe to seek to natively
// (buffered is useless: native HLS reports the whole file as buffered). total is the file's real
// length (RD/ffprobe), never v.duration: some players only report what they've loaded so far.
// aim = where a far seek is headed while the remote is still pressing: one restart once the key
// is let go, not one per press.
let base = 0;
let reach = 0;
let aim: number | null = null;
let aimTimer: ReturnType<typeof setTimeout> | undefined;
let fails = 0;
let failAt = 0;
let startAt = 0;
let loadAt = 0;
let seekAt = 0;
let lastSave = 0;

// next episode: resolved by the server when this one started. The card shows in the last 30 s; at
// the end it starts by itself after a short countdown. Back hides it and cancels.
let nextUp: PlayRequest | null = null;
let nextName = '';
let nextOff = false;
let nextTimer: ReturnType<typeof setInterval> | undefined;
let nextCount: number | null = null;
let nextShown = false;

// external subtitles drawn over the video, timed on the real film position; delay = seconds
// added to every cue (+ = later), remembered per subtitle file
let cues: Cue[] = [];
let delay = 0;
let cue = '';
let imgCues: NativeCue[] = [];

// --- the view ---

const now = () => aim ?? base + (v?.currentTime ?? 0);
const total = () => live?.duration || base + (v?.duration || 0);

function snapshot(): PlayerView {
	return {
		open,
		idle,
		title: req?.title ?? '',
		info,
		art: req?.art ?? req?.poster,
		wait,
		paused: v?.paused ?? true,
		now: now(),
		total: total(),
		restart,
		live,
		sel: { ...sel },
		next: nextUp && nextShown ? {
			name: `S${nextUp.s} E${nextUp.e}${nextName ? ' : ' + nextName : ''}`,
			countdown: nextCount,
		} : null,
		cue,
		imgCues,
		native: !!nv && v === nv,
		delay,
	};
}

let view: PlayerView = snapshot();
const listeners = new Set<() => void>();

function emit() {
	view = snapshot();
	listeners.forEach(l => l());
}

export const subscribe = (l: () => void) => {
	listeners.add(l);
	return () => listeners.delete(l);
};
export const getView = () => view;
export const playingNow = () => !!live;
export const currentRequest = () => req;
export const currentLive = () => live;

// --- the server's log: playback trouble on a TV can be read from there ---

const plog = (msg: string) => {
	const err = v?.error ? `err=${v.error.message ?? v.error.code} ` : '';
	const where = `${hms(now())}/${hms(total())} base=${base} cur=${Math.round(v?.currentTime ?? 0)}`;
	post('log', {
		dev: me.name,
		msg: `${err}${where} dur=${Math.round(v?.duration ?? 0)} ${msg}`,
	}).catch(() => {});
};

addEventListener('error', e => {
	if (live) plog('js ' + String(e.error?.stack ?? e.message).slice(0, 250));
});
addEventListener('unhandledrejection', e => {
	if (live) plog('promise ' + String(e.reason?.stack ?? e.reason).slice(0, 250));
});

const memory = performance as Performance & { memory?: { jsHeapSizeLimit: number } };
const devInfo = () => {
	const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
	const heap = Math.round((memory.memory?.jsHeapSizeLimit ?? 0) / 2 ** 20);
	return `mem=${mem}GB heap=${heap}MB coi=${self.crossOriginIsolated}`;
};

const STAT = /decoder|buffer|drop|network|bandwidth|speed|frame|queue|sync|state|health/i;

function moviStats() {
	if (!v || v === video) return '';
	try {
		const st = v.player?.getStats?.() ?? {};
		const shown = Object.entries(st)
			.filter(([k]) => STAT.test(k))
			.map(([k, x]) => `${k}=${x}`).join(', ').slice(0, 500);
		const buf = Math.round((v.player?.source?.bufferSize ?? 0) / 2 ** 20);
		return ` sw=${v.player?.isSoftwareDecoding?.()} bufMB=${buf} ${shown}`;
	} catch (err) {
		return ' stats? ' + (err as Error).message;
	}
}

// --- waiting messages ---

function waiting(msg: string, sub = '', spin = true) {
	wait = {
		msg,
		sub,
		spin,
	};
	emit();
}

// track names come in English (French, Japanese…, from the file or RD): shown translated
const named = (ts: MediaTrack[]): Named[] => ts.map(tr => {
	const same = ts.filter(x => x.label === tr.label && !!x.ext === !!tr.ext);
	const label = tr.label === 'Unknown' ? t`Unknown language` : trackLabel(tr.label ?? '');
	const n = same.length > 1 ? ' ' + (same.indexOf(tr) + 1) : '';
	return {
		...tr,
		name: label + n + (tr.ext ? ' ' + t`(OpenSubtitles)` : ''),
	};
});

/** "French (forced)" and the like, in the interface's language */
function trackLabel(label: string) {
	const forced = / \(forced\)$/.test(label);
	const base = label.replace(/ \(forced\)$/, '');
	const known: Record<string, string> = {
		French: t`French`,
		English: t`English`,
		Japanese: t`Japanese`,
		Spanish: t`Spanish`,
		German: t`German`,
		Italian: t`Italian`,
		Korean: t`Korean`,
		Chinese: t`Chinese`,
		Portuguese: t`Portuguese`,
		Russian: t`Russian`,
		Dutch: t`Dutch`,
		Arabic: t`Arabic`,
	};
	return (known[base] ?? base) + (forced ? ' ' + t`(forced)` : '');
}

// --- which player ---

/** set by the player component once its <video> and Movi's spot exist */
export function attach(el: HTMLVideoElement, host: HTMLElement) {
	video = el;
	moviHost = host;
	v ??= el;
	bind(el);
	if (nv) {
		bind(nv);
		nv.onCues = list => {
			imgCues = list.filter(c => c.img);
			const text = list.filter(c => c.text).map(c => esc(c.text!).replace(/\n/g, '<br>')).join('<br>');
			if (!cues.length) cue = text;
			emit();
		};
	}
}

const esc = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

/** a file the device decodes itself: Movi in a browser, Android's player in the TV app */
async function switchPlayer(on: boolean) {
	if (nv) {
		if (!on && v === nv) nv.stop();
		nativeOn(on);
		if (on) video!.pause();
		v = on ? nv : video;
		if (video) video.hidden = on;
		return;
	}
	if (!on) {
		if (movi) {
			movi.pause();
			movi.dispose?.();
			movi.remove();
			movi = null;
		}
		video!.hidden = false;
		v = video;
		return;
	}
	await moviReady();
	if (live || req) plog('movi start ' + devInfo());
	if (!movi) {
		movi = newMovi();
		moviHost!.append(movi);
		bind(movi);
	}
	video!.pause();
	video!.hidden = true;
	v = movi;
}

// --- finding a source ---

type Answer = string | null;
let confirmSheet: (r: Confirm) => Promise<Answer> = async () => null;
/** the indexer's confirmation sheet (sheets/indexer.tsx) */
export const setConfirmSheet = (fn: typeof confirmSheet) => {
	confirmSheet = fn;
};

const isTz = (u: string) => /^(tz|c411):/.test(u);
const isPending = (r: PlayReply): r is Extract<PlayReply, { pending: unknown }> => 'pending' in r;
const isConfirm = (r: PlayReply): r is Confirm => 'confirm' in r;

async function ask(p: PlayRequest, extra: Partial<PlayBody> = {}) {
	const caps = getCaps();
	return post('play', {
		...p,
		quality: preferredQuality() || undefined,
		hw: await hwList(),
		net: caps?.net || undefined,
		direct: directOn() ? 1 : undefined,
		...extra,
	});
}

function lookingFor(p: PlayRequest) {
	if (p.url) return waiting(t`Preparing the source`);
	const preset = currentPreset();
	const mode = p.tier ? tierTag(p.tier) : preset?.name ?? '';
	waiting(t`Looking for a ${mode} source`, p.tier ? tierSays(p.tier) : presetSays(preset));
}

const sourcesOf = (n: number) => t`${n} sources`;

function downloadingNow(d: Extract<PlayReply, { pending: unknown }>['pending']) {
	const seedbox = names().seedbox;
	const n = d.progress;
	const speed = d.speed && `${dec((d.speed / 1e6).toFixed(1))} ${t`MB/s`}`;
	const sources = d.seeders && sourcesOf(d.seeders);
	waiting(
		d.status === 'downloading' ? t`${seedbox} is downloading it: ${n}%` : t`${seedbox} is preparing the download`,
		[speed, sources].filter(Boolean).join(', '),
	);
}

/** asks until a file plays: confirms an indexer download, waits for qBittorrent */
async function settle(p: PlayRequest): Promise<Playing | null> {
	let r = await ask(p);
	if (req !== p) return null;
	if (isConfirm(r)) { // an indexer release RD doesn't hold yet: never download without a yes
		const yes = await confirmSheet(r);
		if (req !== p) return null;
		if (!yes) {
			history.back();
			return null;
		}
		r = yes === 'now' && r.fallback ? r.fallback : await ask(p, {
			url: yes,
			confirm: isTz(yes) ? 1 : undefined,
		});
		if (req !== p) return null;
	}
	while (isPending(r)) { // qBittorrent is downloading it
		downloadingNow(r.pending);
		await new Promise(ok => setTimeout(ok, 3000));
		if (req !== p) return null;
		r = await ask(p, {
			url: r.url,
			confirm: 1,
		});
		if (req !== p) return null;
	}
	return isConfirm(r) ? r.fallback : r;
}

/** opens the player on a title (the play page) */
export function play(p: PlayRequest) {
	start(p).catch((err: Error) => {
		if (req === p) waiting(t`No source found`, err.message, false);
	});
}

async function start(p: PlayRequest) {
	req = p;
	live = null;
	fails = 0;
	open = true;
	info = p.ep ?? '';
	restart = false;
	nextUp = null;
	hideNext();
	wake();
	lookingFor(p);
	if (!getCaps()) {
		waiting(t`Testing this device`, t`This happens once. It takes a few seconds to learn which versions this device plays well.`);
		await runBench().catch(() => {});
		if (req !== p) return;
	}
	const r = await settle(p);
	if (!r || req !== p) return;
	try {
		await switchPlayer(!!r.wb);
	} catch (err) {
		return waiting(t`Can’t play`, (err as Error).message, false);
	}
	if (req !== p) return;
	begin(p, r);
}

function begin(p: PlayRequest, r: Playing) {
	live = {
		...r,
		audio: named(r.audio),
		subs: named(r.subs),
	};
	nextUp = r.next ? {
		...p,
		s: r.next.s,
		e: r.next.e,
		ep: episodeName(r.next.s, r.next.e),
		url: undefined,
		art: r.next.still?.replace(/\/w\d+\//, '/original/') ?? p.art,
	} : null;
	nextName = r.next?.name ?? '';
	sel = {
		audio: r.pick?.audio ?? live.audio[0]?.id ?? '',
		sub: r.pick?.sub ?? 'none',
	};
	info = [p.ep, r.tier ? tierTag(r.tier) : t`Language not verified`, RES_LABEL[r.res]]
		.filter(Boolean).join('   ');
	const from = resumePoint(p);
	restart = !!from;
	loadCues();
	loadSource(from);
	if (from) {
		const time = hms(from);
		toast(t`Resuming at ${time}`, 2500);
	}
}

const progressKey = (p: { imdb?: string; s?: number; e?: number }) =>
	(p.imdb ?? '') + (p.e ? `:${p.s}:${p.e}` : '');

/** where this film/episode was left, unless it was finished */
function resumePoint(p: PlayRequest) {
	const pr = app().progress[progressKey(p)];
	return pr && !pr.watched && pr.pos > 30 && pr.pos < pr.dur - 60 ? pr.pos - 5 : 0;
}

// --- loading a stream ---

/** RD transcoder URL, audio and subtitles baked in. RD outputs 1080p at most; lower only if the
 *  source or the device wants it. */
function src() {
	const r = live!;
	if (r.wb) return r.wb;
	if (!r.model) return r.direct ?? '';
	// never 'full': it passes 4K/AV1/HEVC through and stalls. RD serves these even when
	// availableQualities only lists 'full'.
	const target = Math.min(r.res || 1080, preferredQuality() || 1080);
	const quality = target >= 1080 ? '1080p_8mbps' : target >= 720 ? '720p_4mbps' : '480p_2mbps';
	return r.model
		.replace('{audio}', sel.audio)
		.replace('{subtitles}', sel.sub.startsWith('ext-') ? 'none' : sel.sub)
		.replace('{audioCodec}', 'aac')
		.replace('{quality}', quality)
		.replace('{format}', 'm3u8');
}

/** the chosen tracks by their order among the file's audio / embedded subtitle tracks (the TV
 *  app counts the same way) */
const trackOrder = (): [number, number] => [
	live!.audio.filter(a => !a.ext).findIndex(a => a.id === sel.audio),
	live!.subs.filter(x => !x.ext).findIndex(x => x.id === sel.sub),
];

/** Movi tracks: ids are the file's stream indexes (a2 = stream 2) */
function tracks() {
	if (nv && v === nv && live?.wb) return nv.tracks(...trackOrder());
	if (!live?.wb || !v?.player) return;
	v.player.selectAudioTrack?.(+sel.audio.slice(1));
	v.player.selectSubtitleTrack?.(/^s\d+$/.test(sel.sub) ? +sel.sub.slice(1) : null);
}

function loadSource(at: number) {
	if (live) plog(`load ${Math.round(at)}`);
	startAt = at;
	loadAt = Date.now();
	hls?.destroy();
	hls = null;
	clearTimeout(aimTimer);
	aim = null;
	const time = hms(at);
	waiting(at ? t`Resuming at ${time}` : t`Starting`, '');
	if (live!.wb) return loadFile(at);
	loadStream(at);
}

/** one file, played by the device: it seeks itself, tracks switch in place */
function loadFile(at: number) {
	const u = src();
	base = 0;
	reach = 0;
	const go = () => {
		tracks();
		begin2();
	};
	if (v!.getAttribute('src') === u && v!.duration > 0) { // same file: a plain seek
		if (at) v!.currentTime = at;
		return go();
	}
	if (nv && v === nv) {
		const [a, s] = trackOrder();
		nv.addEventListener('loadeddata', () => begin2(), { once: true });
		return nv.open(u, at, a, s);
	}
	// a new file starts where asked through Movi's own startat: a seek on loadeddata is ignored
	v!.setAttribute('startat', String(at));
	v!.addEventListener('loadeddata', go, { once: true });
	v!.src = u;
}

// hls.js wherever MSE exists: Chrome's own HLS player chokes on RD segments
// (DEMUXER_ERROR_COULD_NOT_PARSE). Native HLS only where hls.js can't run (iPhone Safari).
async function loadStream(at: number) {
	let u = src();
	const m3u8 = u.includes('.m3u8');
	base = m3u8 ? Math.floor(at) : 0;
	reach = 0;
	if (base) u += '?t=' + base;
	const Hls = m3u8 ? (await import('hls.js')).default : null;
	if (Hls?.isSupported()) {
		const h = new Hls({ fLoader: wholeSegments(Hls) as unknown as FragmentLoaderConstructor });
		hls = h;
		h.loadSource(u);
		h.attachMedia(v as HTMLVideoElement);
		watchHls(Hls, h);
	} else {
		v!.src = u;
		video!.onloadedmetadata = () => {
			if (at && !base) v!.currentTime = at;
		};
	}
	begin2();
}

function watchHls(Hls: typeof HlsType, h: HlsType) {
	let recovered = false;
	h.on(Hls.Events.ERROR, (_, d) => {
		if (d.details !== 'bufferStalledError' || d.fatal) {
			const code = d.response?.code ?? '';
			plog(`hls ${d.fatal ? 'FATAL ' : ''}${d.type}/${d.details} ${code} ${d.frag?.sn ?? ''}`);
		}
		if (!d.fatal) return;
		if (d.type === Hls.ErrorTypes.MEDIA_ERROR && !recovered) {
			recovered = true;
			h.recoverMediaError();
		} else broken();
	});
}

// RD hands out segments it is still writing: 200 + matching Content-Length, but cut short (or
// empty). A finished MPEG-TS segment is always a whole number of 188-byte packets, so anything
// else gets fetched again.
function wholeSegments(Hls: typeof HlsType) {
	const Base = Hls.DefaultConfig.loader;
	return class WholeSegments extends Base {
		private retry?: ReturnType<typeof setTimeout>;
		private child?: WholeSegments;
		constructor(private c: ConstructorParameters<typeof Base>[0]) {
			super(c);
		}
		load(ctx: LoaderContext, cfg: LoaderConfiguration, cb: LoaderCallbacks<LoaderContext>) {
			super.load(ctx, cfg, {
				...cb,
				onSuccess: (res, stats, c, net) => {
					const data = res.data as ArrayBuffer | string | undefined;
					const n = typeof data === 'string' ? data.length : data?.byteLength ?? -1;
					const tries = (ctx as LoaderContext & { partialTries?: number }).partialTries ?? 0;
					if ((n === 0 || n % 188) && tries < 30) { // loaders are single-use: retry with a new one
						(ctx as LoaderContext & { partialTries?: number }).partialTries = tries + 1;
						this.retry = setTimeout(() => {
							this.child = new WholeSegments(this.c);
							this.child.load(ctx, cfg, cb);
						}, 1000);
						return;
					}
					cb.onSuccess(res, stats, c, net);
				},
			});
		}
		abort() {
			clearTimeout(this.retry);
			this.child?.abort();
			super.abort();
		}
		destroy() {
			clearTimeout(this.retry);
			this.child?.destroy();
			super.destroy();
		}
	};
}

// browsers refuse sound without a recent tap/key (iPhone, TV browsers, a device that received a
// "send"): start muted instead
function begin2() {
	v!.play().catch((err: Error) => {
		if (err.name !== 'NotAllowedError') return;
		v!.muted = true;
		v!.play()
			.then(() => toast(t`Sound muted by the browser: press any key to turn it on`, 8000))
			.catch(() => waiting(t`Ready`, t`Press play to start`, false));
	});
}

const unmute = () => {
	if (v?.muted) v.muted = false;
};
addEventListener('pointerdown', unmute, true);
addEventListener('keydown', unmute, true);

/** a stream that broke before playing keeps the spot it was asked for */
const pos = () => (v?.currentTime ?? 0) > 0 ? now() : startAt;

// a broken stream restarts where it stopped, twice, before giving up
async function broken() {
	if (!live) return;
	plog(`broken, fails=${fails}`);
	if (pos() - failAt > 120) fails = 0; // a long film may hit this more than twice
	failAt = pos();
	if (live.wb && live.rd && fails++) { // failed twice on RD's original: back to its transcoder
		const at = pos();
		const rd = live.rd;
		live = {
			...live,
			wb: undefined,
			rd: undefined,
			model: rd.model,
			audio: named(rd.audio),
			subs: named(rd.subs),
		};
		sel = {
			audio: rd.pick?.audio ?? live.audio[0]?.id ?? '',
			sub: rd.pick?.sub ?? 'none',
		};
		fails = 0;
		await switchPlayer(false);
		return loadSource(at);
	}
	if (fails++ < 2) return loadSource(pos());
	waiting(t`Can’t play`, t`Try another source in Quality.`, false);
}

// formats this device claims to decode but can't at full speed, learned while playing: the
// decoder keeps falling behind in plain playback (not right after a jump): try another release
let lagN = 0;
let lagAt = 0;

/** the decoder has a backlog and nothing ready to show, three times within two minutes */
function lagging(m: Media) {
	const st = m.player?.getStats?.() ?? {};
	const backlog = parseInt(String(st['Video Decoder Queue']));
	const ready = parseInt(String(st['Video Queue']));
	if (!(backlog >= 15 && ready <= 1)) return false;
	if (Date.now() - lagAt > 120000) lagN = 0;
	lagAt = Date.now();
	return ++lagN >= 3;
}

/** this format plays too slowly here: the device test's result says so from now on */
function markSlow(k: Format) {
	const caps = getCaps() ?? {
		v: CAPS_VERSION,
		at: Date.now(),
		net: 0,
		results: {},
	};
	setCaps({
		...caps,
		results: {
			...caps.results,
			[k]: {
				...caps.results[k],
				name: FORMAT_NAME[k],
				ok: false,
				lagged: true,
			},
		},
	});
}

function lagCheck() {
	if (!v || v === video || !live?.video || Date.now() - Math.max(loadAt, seekAt) < 15000) return;
	if (!lagging(v)) return;
	const vid = live.video;
	const k = vid.height > 1200 ? '4k' : vid.codec === 'hevc' ? 'hevc10' : vid.codec;
	if ((FORMATS as readonly string[]).includes(k)) markSlow(k as Format);
	plog(`decoder too slow for ${k}: switching release`);
	lagN = 0;
	toast(t`This device struggles with this version: switching to another`, 4000);
	saveProgress(true);
	play({
		...req!,
		url: undefined,
	});
}

// --- progress: saved every 15 s while playing and when leaving; past 90% counts as watched ---

function saveProgress(force = false) {
	// duration is unknown (NaN) while a stream (re)loads: saving then would look like "past 90%"
	const r = req;
	if (!live || !r?.imdb || !v || !(v.duration > 0) || v.seeking || now() < 5) return;
	if (!force && Date.now() - lastSave < 15000) return;
	// never overwrite a resume point with a failed resume
	if (startAt > 60 && now() < startAt - 30 && Date.now() - loadAt < 30000) {
		return plog('resume missed, position not saved');
	}
	lastSave = Date.now();
	const key = progressKey(r);
	const at = now();
	const dur = total();
	const infoOf = {
		id: r.id,
		type: r.type,
		title: r.title,
		poster: r.poster,
		art: r.art,
		imdb: r.imdb,
		lang: r.lang,
		s: r.s,
		e: r.e,
	};
	const watched = at / dur > 0.9;
	setApp({
		progress: {
			...app().progress,
			[key]: {
				...app().progress[key],
				...infoOf,
				pos: at,
				dur,
				watched,
				at: Date.now(),
			},
		},
	});
	post('progress', {
		key,
		pos: at,
		dur,
		watched,
		info: infoOf,
	}).catch(() => {});
}

// --- controls ---

export function togglePlay() {
	if (!v) return;
	if (v.paused) begin2();
	else v.pause();
}

export function seekTo(abs: number) {
	if (!live || !v || !(total() > 0)) return;
	const target = Math.max(0, Math.min(abs, total() - 5));
	const rel = target - base;
	const near = rel >= 0 && rel <= reach + 60 && rel < (v.duration || 0) - 10;
	seekAt = Date.now();
	if (aim === null && !live.wb && (near || !live.model)) {
		v.currentTime = rel;
		return;
	}
	// a held key: one seek once it's let go (the device decoder trips on a burst of seeks; the
	// transcoder restarts once)
	aim = target;
	emit();
	clearTimeout(aimTimer);
	aimTimer = setTimeout(() => {
		aim = null;
		if (live!.wb || !live!.model || near) v!.currentTime = rel;
		else loadSource(target);
	}, live.wb ? 350 : 700);
}

export const seekBy = (d: number) => seekTo(now() + d);

export function startOver() {
	restart = false;
	loadSource(0);
}

/** a quality, audio or subtitle choice */
export function chooseTrack(kind: 'audio' | 'sub', id: string) {
	const was = src();
	sel = {
		...sel,
		[kind]: id,
	};
	loadCues();
	emit();
	if (live!.wb) tracks();
	else if (src() !== was) loadSource(now()); // switching between external subtitles needs no restart
}

const delayKey = () => `subdelay:${live?.subs.find(x => x.id === sel.sub)?.url}` as const;

/** shifts external subtitles */
export function nudge(d: number) {
	delay = Math.round((delay + d) * 10) / 10;
	keep(delayKey(), delay || null);
	drawCue();
	emit();
}

async function loadCues() {
	cues = [];
	cue = '';
	const tr = live?.subs.find(x => x.id === sel.sub && x.ext);
	if (!tr?.url) return emit();
	delay = Number(load(delayKey())) || 0;
	try {
		cues = parseSrt(await (await fetch(tr.url)).text());
	} catch {
		toast(t`These subtitles couldn’t be loaded`);
	}
}

function drawCue() {
	if (!cues.length) return;
	const h = cueAt(cues, now() - delay);
	if (h !== cue) {
		cue = h;
		emit();
	}
}
setInterval(drawCue, 100);

// --- next episode ---

function hideNext() {
	nextShown = false;
	nextCount = null;
	clearInterval(nextTimer);
	nextTimer = undefined;
}

export function dismissNext() {
	hideNext();
	nextOff = true;
	emit();
}

function countdown() {
	if (!nextUp || nextOff || nextTimer) return;
	nextShown = true;
	nextCount = 8;
	emit();
	nextTimer = setInterval(() => {
		if (nextCount! <= 1) return goNext();
		nextCount!--;
		emit();
	}, 1000);
}

export function goNext() {
	const n = nextUp;
	if (!n) return;
	hideNext();
	saveProgress(true);
	nextOff = false;
	location.replace('#/play/' + encodeURIComponent(JSON.stringify(n)));
}

function nearEnd() {
	const left = total() - now();
	if (total() > 60 && left < 30) {
		if (!nextShown && nextUp && !nextOff) nextShown = true;
		if (left < 1.5) countdown();
	} else if (!nextTimer) {
		nextShown = false;
		nextOff = false;
	}
}

// --- the media element's events ---

function bind(el: Media) {
	const mine = () => el === v;
	el.addEventListener('ended', () => {
		if (!mine()) return;
		// stopped short of the real end: the stream ran dry, not the episode
		if (now() < total() - 10) return broken();
		countdown();
	});
	el.addEventListener('playing', () => {
		wait = null;
		emit();
	});
	for (const e of ['waiting', 'stalled', 'ended', 'emptied']) el.addEventListener(e, () => {
		if (!mine() || !live) return;
		plog(e + moviStats());
		if (e === 'waiting') lagCheck();
	});
	for (const e of ['play', 'pause']) el.addEventListener(e, () => {
		if (!mine()) return;
		wake();
	});
	el.addEventListener('pause', () => mine() && saveProgress(true));
	el.addEventListener('timeupdate', () => {
		if (!mine()) return;
		if (!v!.seeking) reach = Math.max(reach, v!.currentTime);
		saveProgress();
		nearEnd();
		emit();
	});
	el.addEventListener('error', () => mine() && broken());
}

// --- leaving ---

export function stop() {
	if (!open) return;
	hideNext();
	saveProgress(true);
	cues = [];
	cue = '';
	open = false;
	hls?.destroy();
	hls = null;
	switchPlayer(false);
	if (video) {
		video.pause();
		video.removeAttribute('src');
		video.load();
	}
	live = null;
	req = null; // an answer still on its way finds nobody waiting
	wait = null;
	emit();
}

// --- controls fade after 4 s of playback ---

let idleTimer: ReturnType<typeof setTimeout> | undefined;
export function wake() {
	idle = false;
	clearTimeout(idleTimer);
	idleTimer = setTimeout(() => {
		if (!v || v.paused || sheetOpen() || !live) return wake();
		hideControls();
	}, 4000);
	emit();
}

export function hideControls() {
	idle = true;
	(document.activeElement as HTMLElement | null)?.blur();
	emit();
}

/** Back on the TV remote, first: the next-episode card hides (keep watching the credits) */
export function backFromNext() {
	if (!nextShown) return false;
	dismissNext();
	return true;
}

/** Back on the TV remote, after any sheet: the controls hide while it plays */
export function backFromControls() {
	if (!open || idle || !live || !v || v.paused) return false;
	hideControls();
	return true;
}

// Remote with controls hidden: OK play/pause, ←/→ seek, ↑/↓ show controls. With controls shown,
// arrows move between buttons as usual (the page's focus navigation).
const MEDIA_KEYS: Record<string, () => void> = {
	MediaPlayPause: togglePlay,
	MediaPlay: () => v?.play(),
	MediaPause: () => v?.pause(),
	MediaRewind: () => seekBy(-10),
	MediaFastForward: () => seekBy(30),
};

function nextKeys(e: KeyboardEvent) {
	if (!nextShown || (e.key !== 'Enter' && e.key !== 'Escape')) return false;
	e.preventDefault();
	if (e.key === 'Enter') goNext();
	else dismissNext();
	return true;
}

addEventListener('keydown', e => {
	if (!open || sheetOpen()) return;
	const hidden = idle;
	wake();
	if (nextKeys(e)) return;
	const media = MEDIA_KEYS[e.key];
	if (media) {
		media();
		return e.preventDefault();
	}
	if (!hidden && document.activeElement && document.activeElement !== document.body) return;
	const focusPlay = () => document.querySelector<HTMLElement>('#pp')?.focus();
	const act: Record<string, () => void> = {
		'Enter': togglePlay,
		' ': togglePlay,
		'ArrowLeft': () => seekBy(-10),
		'ArrowRight': () => seekBy(30),
		'ArrowUp': focusPlay,
		'ArrowDown': focusPlay,
	};
	const fn = act[e.key];
	if (fn) {
		fn();
		e.preventDefault();
	}
});
