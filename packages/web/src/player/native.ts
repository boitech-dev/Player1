import type { MoviPlayer } from './movi.ts';

// TV app: Android's own player (hardware video, every audio codec) draws under the page, which
// stays the interface. The app adds window.P1N; NativeVideo looks like a <video> to the rest of the
// page, and the app reports back through window.p1n(event, data).

interface Bridge {
	load(url: string, at: number, audio: number, sub: number): void;
	test(url: string, rate: number): void;
	play(): void;
	pause(): void;
	seek(t: number): void;
	tracks(audio: number, sub: number): void;
	stop(): void;
	version(): number;
}

/** a subtitle the app read from the file: text, or a picture placed where the file says */
export interface NativeCue {
	text?: string;
	img?: string;
	x: number;
	y: number;
	w: number;
}

/** what the app measured playing a test clip */
export interface NativeTestResult {
	error?: string;
	/** clip length, seconds */
	d: number;
	ms: number;
	rendered: number;
	dropped: number;
	stalls: number;
}

declare global {
	interface Window {
		P1N?: Bridge;
		p1n?: (e: string, x: unknown) => void;
		/** the TV app's Back button asks this first: true = handled here */
		p1Back?: () => boolean;
	}
}

/** what the page needs of any player: <video>, <movi-player>, or the TV app's */
export interface Media extends EventTarget {
	currentTime: number;
	readonly duration: number;
	readonly paused: boolean;
	muted: boolean;
	playbackRate: number;
	readonly error: { message?: string; code?: number } | null;
	readonly seeking?: boolean;
	src: string;
	player?: MoviPlayer;
	play(): Promise<void>;
	pause(): void;
	getAttribute(k: string): string | null;
	setAttribute(k: string, v: string): void;
}

export class NativeVideo extends EventTarget implements Media {
	t = 0;
	d = NaN;
	paused = true;
	muted = false;
	playbackRate = 1;
	error: { message?: string } | null = null;
	private url = '';
	onTest: ((r: NativeTestResult) => void) | null = null;
	onCues: ((c: NativeCue[]) => void) | null = null;

	constructor(private app: Bridge) {
		super();
	}

	get currentTime() {
		return this.t;
	}
	set currentTime(x: number) {
		this.t = x;
		this.app.seek(x);
	}
	get duration() {
		return this.d;
	}
	get src() {
		return this.url;
	}
	set src(_: string) {
		// files open through open(), with their tracks
	}
	getAttribute(k: string) {
		return k === 'src' ? this.url : null;
	}
	setAttribute() {}

	open(u: string, at: number, audio: number, sub: number) {
		Object.assign(this, {
			url: u,
			t: at,
			d: NaN,
			error: null,
			paused: false,
		});
		this.app.load(u, at, audio, sub);
	}
	play() {
		this.paused = false;
		this.app.play();
		this.dispatchEvent(new Event('play'));
		return Promise.resolve();
	}
	pause() {
		this.paused = true;
		this.app.pause();
		this.dispatchEvent(new Event('pause'));
	}
	stop() {
		this.url = '';
		this.paused = true;
		this.app.stop();
		this.onCues?.([]);
	}
	tracks(audio: number, sub: number) {
		this.app.tracks(audio, sub);
	}
	test(url: string, rate: number) {
		this.app.test(url, rate);
	}

	/** an event from the app */
	receive(e: string, x: unknown) {
		const data = (x ?? {}) as Record<string, unknown>;
		if (e === 'test') return this.onTest?.(x as NativeTestResult);
		if (e === 'cues') return this.onCues?.(data.cues as NativeCue[]);
		if (e === 'time') {
			this.t = Number(data.t);
			if (data.d) this.d = Number(data.d);
			e = 'timeupdate';
		}
		if (e === 'playing') this.paused = false;
		if (e === 'pause') this.paused = true;
		if (e === 'error') this.error = { message: String(data.message) };
		this.dispatchEvent(new Event(e));
	}
}

/** the TV app's player, or null in a browser */
export const nv = window.P1N ? new NativeVideo(window.P1N) : null;
if (nv) window.p1n = (e, x) => nv.receive(e, x);

/** while the app's player shows, the page clears its own backgrounds */
export const nativeOn = (on: boolean) =>
	document.documentElement.toggleAttribute('data-native', on);
