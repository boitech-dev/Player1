import { t } from '@lingui/core/macro';
import { useSyncExternalStore } from 'react';

import {
	type Format,
	FORMATS,
	type TestClip,
} from '@player1/shared/release';

import { connect } from '../app/events.ts';
import { post } from '../lib/api.ts';
import {
	type Caps,
	CAPS_VERSION,
	formatName,
	type FormatResult,
	me,
	setCaps,
	webOS,
} from '../lib/device.ts';
import { cx } from '../ui/cx.ts';
import s from './bench.module.scss';
import {
	moviReady,
	newMovi,
} from './movi.ts';
import {
	nativeOn,
	type NativeTestResult,
	nv,
} from './native.ts';

// The device test: the same moment of a film in each format, played by the real player (decoder,
// frame queue, audio, drawing) at 1.25x for margin. It must play through without stalling and show
// nearly every frame. The clips are a free film's (Sol Levante): the server fetches them, see its
// samples.ts.

const RATE = 1.25;

type Sample = TestClip;

// --- the run in progress, for the playback sheet ---

interface Run {
	key: Format | null;
	results: Partial<Record<Format, FormatResult>>;
}

let run: Run | null = null;
let running: Promise<Caps> | null = null;
let playingNow = () => false;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach(l => l());
const subscribe = (l: () => void) => {
	listeners.add(l);
	return () => listeners.delete(l);
};

/** the test in progress, or null */
export const useBench = () => useSyncExternalStore(subscribe, () => run);

/** the player tells the test whether a film is on (the TV app's layer stays on for it) */
export const setPlayingCheck = (fn: () => boolean) => {
	playingNow = fn;
};

/** a full-screen box with nothing over the clip: hidden or covered, a weak WebView redraws less */
function overlay(m: Sample, native: boolean) {
	const box = document.createElement('div');
	box.className = cx(s.testplay, native && s.native);
	const p = document.createElement('p');
	const b = document.createElement('strong');
	const n = FORMATS.indexOf(m.key) + 1;
	const total = FORMATS.length;
	b.textContent = t`Test ${n} of ${total}:`;
	p.append(b, ' ' + formatName(m.key));
	box.append(p);
	document.body.append(box);
	return box;
}

const verdict = (smooth: number, speed: number, stalls: number, rate = RATE) =>
	!stalls && smooth >= 0.9 && speed >= rate * 0.95;

async function decodable(m: Sample) {
	if (!('VideoDecoder' in window)) return t`This browser can’t play original files by itself`;
	try {
		const ok = (await VideoDecoder.isConfigSupported({
			codec: m.codec,
			codedWidth: m.width,
			codedHeight: m.height,
		})).supported;
		return ok ? null : 'Not supported';
	} catch {
		return 'Not supported';
	}
}

/** count every frame Movi actually puts on screen */
function countFrames(el: ReturnType<typeof newMovi>) {
	const counter = { shown: 0 };
	const r = el.player?.videoRenderer;
	const hook = r?.onFramePresented;
	if (r) r.onFramePresented = t => {
		counter.shown++;
		return hook?.call(r, t);
	};
	return counter;
}

async function moviTest(m: Sample): Promise<FormatResult> {
	const no = await decodable(m);
	if (no) return {
		ok: false,
		why: no,
	};
	await moviReady();
	const el = newMovi();
	el.muted = true;
	const box = overlay(m, false);
	box.prepend(el);
	let frames = 0;
	let rafOn = true;
	const tick = () => {
		frames++;
		if (rafOn) requestAnimationFrame(tick);
	};
	requestAnimationFrame(tick); // how often the page redraws
	// the player rewinds at the end: keep the furthest point
	let stalls = 0;
	let startedAt = 0;
	let reached = 0;
	let endedAt = 0;
	el.addEventListener('playing', () => startedAt ||= performance.now());
	el.addEventListener('timeupdate', () => reached = Math.max(reached, el.currentTime || 0));
	// the first second is the start, not a stall
	el.addEventListener('waiting', () => startedAt && performance.now() - startedAt > 1000 && stalls++);
	const ended = new Promise<void>(r => el.addEventListener('ended', () => {
		endedAt = performance.now();
		r();
	}, { once: true }));
	try {
		const loaded = new Promise((ok, ko) => {
			el.addEventListener('loadeddata', ok, { once: true });
			el.addEventListener('error', () => ko(new Error('load')), { once: true });
		});
		el.src = `/samples/${m.key}.mkv`;
		const late = new Promise((_, ko) => setTimeout(() => ko(new Error('timeout')), 20000));
		await Promise.race([loaded, late]);
		const counter = countFrames(el);
		const secs = el.duration || 8;
		el.playbackRate = RATE;
		await el.play();
		// half speed at worst, then stop
		await Promise.race([ended, new Promise(r => setTimeout(r, (secs / RATE * 2 + 5) * 1000))]);
		if (endedAt) reached = secs;
		const expected = Math.round(reached * m.fps);
		const elapsed = ((endedAt || performance.now()) - startedAt) / 1000;
		const speed = Math.round(Math.min(reached / elapsed, RATE) * 10) / 10;
		const smooth = expected ? Math.min(1, counter.shown / expected) : 0;
		const redraw = Math.round(frames / ((performance.now() - startedAt) / 1000 + 1e-9));
		return {
			ok: verdict(smooth, speed, stalls),
			speed,
			smooth: Math.round(smooth * 100),
			stalls,
			redraw,
		};
	} catch {
		return {
			ok: false,
			why: 'Playback failed',
		};
	} finally {
		rafOn = false;
		try {
			el.pause();
			el.player?.destroy?.();
		} catch {
			// already gone
		}
		box.remove();
	}
}

// LG TV: the same clip in the page's own <video>, which webOS hands to the TV's video chip (MKV,
// HEVC, AV1, HDR). At 1x: that chip decodes at the film's pace, whatever the rate asked. Some
// webOS versions draw the video outside the browser and count no frames: then speed and stalls
// decide alone. Timed from the clip's first second on: the start, and the TV switching its screen
// to HDR, pause the picture a moment without saying anything about the decoder.
interface Mark {
	at: number;
	pos: number;
	q?: VideoPlaybackQuality;
}

/** frames presented and dropped between two readings */
const framesSince = (q?: VideoPlaybackQuality, was?: VideoPlaybackQuality) => [
	(q?.totalVideoFrames ?? 0) - (was?.totalVideoFrames ?? 0),
	(q?.droppedVideoFrames ?? 0) - (was?.droppedVideoFrames ?? 0),
] as const;

/** the clip from mark `from` (its first second played) to `end` seconds, reached at time `endAt` */
function score(q: VideoPlaybackQuality | undefined, from: Mark | null, end: number, endAt: number,
	fps: number, stalls: number): FormatResult {
	if (!from) return {
		ok: false,
		why: 'Playback failed',
	};
	const reached = end - from.pos;
	const speed = Math.round(Math.min(reached / ((endAt - from.at) / 1000), 1) * 10) / 10;
	const [total, dropped] = framesSince(q, from.q);
	const shown = total - dropped;
	const counted = !!q?.totalVideoFrames;
	const smooth = counted ? Math.min(1, shown / (reached * fps || 1)) : 1;
	return {
		ok: verdict(smooth, speed, stalls, 1),
		speed,
		smooth: counted ? Math.round(smooth * 100) : undefined,
		stalls,
		dropped: q && dropped,
		native: true,
	};
}

async function videoTest(m: Sample): Promise<FormatResult> {
	const el = document.createElement('video');
	el.muted = true;
	el.style.cssText = 'width:100%;height:100%';
	const box = overlay(m, false);
	box.prepend(el);
	let stalls = 0;
	let from: Mark | null = null;
	let endedAt = 0;
	el.addEventListener('timeupdate', () => {
		if (!from && el.currentTime >= 1) from = {
			at: performance.now(),
			pos: el.currentTime,
			q: el.getVideoPlaybackQuality?.(),
		};
	});
	el.addEventListener('waiting', () => from && stalls++);
	try {
		const loaded = new Promise((ok, ko) => {
			el.addEventListener('loadeddata', ok, { once: true });
			el.addEventListener('error', () => ko(new Error(el.error?.message || 'load')), { once: true });
		});
		el.src = `/samples/${m.key}.mkv`;
		const late = new Promise((_, ko) => setTimeout(() => ko(new Error('timeout')), 20000));
		await Promise.race([loaded, late]);
		const secs = el.duration || 8;
		const ended = new Promise<void>(r => el.addEventListener('ended', () => {
			endedAt = performance.now();
			r();
		}, { once: true }));
		await el.play();
		await Promise.race([ended, new Promise(r => setTimeout(r, (secs * 2 + 5) * 1000))]);
		const end = endedAt ? secs : el.currentTime;
		const q = el.getVideoPlaybackQuality?.();
		return score(q, from, end, endedAt || performance.now(), m.fps, stalls);
	} catch (err) {
		const why = (err as Error).message;
		post('log', {
			dev: me.name,
			msg: `device test ${m.key}: ${why}`,
		}).catch(() => {});
		return {
			ok: false,
			why: /DECODE|SRC_NOT_SUPPORTED|not supported|format/i.test(why)
				? 'Not supported'
				: 'Playback failed',
		};
	} finally {
		el.pause();
		el.removeAttribute('src');
		el.load();
		box.remove();
	}
}

// TV app: the same clip through Android's own player, which counts exactly the frames it showed
// and dropped. Video only: Dolby audio handed to the TV's own processor plays at 1x and would hold
// the clip back from 1.25x.
async function nativeTest(m: Sample): Promise<FormatResult> {
	const box = overlay(m, true);
	nativeOn(true);
	try {
		const r = await Promise.race([
			new Promise<NativeTestResult>(ok => {
				nv!.onTest = ok;
				nv!.test(`/samples/${m.key}.mkv`, RATE);
			}),
			new Promise<NativeTestResult>(ok => setTimeout(() => ok({
				error: 'timeout',
				d: 0,
				ms: 0,
				rendered: 0,
				dropped: 0,
				stalls: 0,
			}), 45000)),
		]);
		if (r.error) {
			nv!.stop();
			return {
				ok: false,
				why: /DECOD|FORMAT|UNSUPPORTED/i.test(r.error) ? 'Not supported' : 'Playback failed',
			};
		}
		const expected = r.d * m.fps;
		const smooth = expected ? Math.min(1, r.rendered / expected) : 0;
		const speed = Math.round(Math.min(r.d / (r.ms / 1000), RATE) * 10) / 10;
		return {
			ok: verdict(smooth, speed, r.stalls),
			speed,
			smooth: Math.round(smooth * 100),
			stalls: r.stalls,
			dropped: r.dropped,
			native: true,
		};
	} finally {
		nv!.onTest = null;
		box.remove();
		if (!playingNow()) nativeOn(false);
	}
}

const json = async <T>(url: string) => (await fetch(url)).json() as Promise<T>;

/** Mbit/s from this server, from the H.264 clip's download */
async function measureNet() {
	const t0 = performance.now();
	const r = await fetch('/samples/h264.mkv', { cache: 'no-store' });
	const n = (await r.arrayBuffer()).byteLength;
	return Math.round(n * 8 / ((performance.now() - t0) / 1000) / 1e6);
}

const describe = (results: Run['results'], net: number) => `device test: net ${net} Mbit/s, `
	+ Object.entries(results).map(([k, r]) => {
		const how = r.native ? `dropped ${r.dropped} (native)` : `redraw ${r.redraw ?? '-'}/s`;
		return `${k} ${r.ok ? 'ok' : 'NO'} ${r.speed ?? '-'}x ${r.smooth ?? '-'}% frames `
			+ `${r.stalls ?? '-'} stalls ${how} ${r.why ?? ''}`;
	}).join(', ');

async function bench(): Promise<Caps> {
	const list = await json<Sample[]>('/samples/index.json');
	run = {
		key: null,
		results: {},
	};
	let net = 0;
	for (const meta of list) {
		run = {
			...run,
			key: meta.key,
		};
		changed();
		if (meta.key === 'h264') net = await measureNet();
		const r = nv ? await nativeTest(meta) : webOS ? await videoTest(meta) : await moviTest(meta);
		run = {
			...run,
			results: {
				...run.results,
				[meta.key]: {
					name: meta.name,
					...r,
				},
			},
		};
		changed(); // shows as soon as it's known
	}
	const caps = {
		v: CAPS_VERSION,
		at: Date.now(),
		net,
		results: run.results,
	};
	setCaps(caps);
	post('log', {
		dev: me.name,
		msg: describe(caps.results, net),
	}).catch(() => {});
	connect(); // the server learns what this device plays
	return caps;
}

/** runs the test once at a time; every caller waits for the same run */
export function runBench() {
	running ??= bench().finally(() => {
		running = null;
		run = null;
		changed();
	});
	return running;
}
