import { t } from '@lingui/core/macro';

// Movi Player: indexer and library files (MKV, Dolby/DTS audio, PGS subtitles) play in the page
// with the device's own decoder (video on its hardware decoder, only the audio in WebAssembly).
// Nothing is converted, here or on the server.
export const MOVI = 'https://cdn.jsdelivr.net/npm/movi-player@0.4.1/dist/';
// Movi's element opens files with a hardcoded 520 MB cache and allocates min(520 MB, 8% of the
// file) in one block before its buffersize setting applies: a 2 GB TV WebView refuses that
// ("Array buffer allocation failed"). Clamp it at the source.
export const MOVI_MB = 64;

export interface MoviStats {
	[k: string]: string | number | undefined;
}

/** what the page uses of Movi's player object */
export interface MoviPlayer {
	getStats?(): MoviStats;
	isSoftwareDecoding?(): boolean;
	source?: { bufferSize?: number };
	videoRenderer?: { onFramePresented?: (t: number) => unknown };
	selectAudioTrack?(i: number): void;
	selectSubtitleTrack?(i: number | null): void;
	destroy?(): void;
}

/** the <movi-player> element: a <video> look-alike */
export interface MoviElement extends HTMLElement {
	src: string;
	currentTime: number;
	readonly duration: number;
	readonly paused: boolean;
	muted: boolean;
	playbackRate: number;
	error: { message?: string; code?: number } | null;
	player?: MoviPlayer;
	play(): Promise<void>;
	pause(): void;
	dispose?(): void;
}

interface HttpSourceProto {
	resizeBuffer?: (this: { maxBufferSizeMB?: number }, n: number) => unknown;
	p1cap?: boolean;
}

function capBuffer() {
	const movi = (window as unknown as { Movi?: { HttpSource?: { prototype: HttpSourceProto } } }).Movi;
	const h = movi?.HttpSource?.prototype;
	if (!h?.resizeBuffer || h.p1cap) return;
	const resize = h.resizeBuffer;
	h.p1cap = true;
	h.resizeBuffer = function (n) {
		this.maxBufferSizeMB = Math.min(this.maxBufferSizeMB ?? MOVI_MB, MOVI_MB);
		return resize.call(this, n);
	};
}

let loading: Promise<void> | null = null;

/** Movi's script, loaded the first time a file needs it */
export function moviReady(): Promise<void> {
	if (customElements.get('movi-player')) return Promise.resolve();
	loading ??= new Promise((ok, ko) => {
		const s = document.createElement('script');
		s.src = MOVI + 'element.slim.global.js';
		s.onload = () => {
			capBuffer();
			ok();
		};
		s.onerror = () => {
			loading = null;
			ko(new Error(t`The player for original files couldn’t load`));
		};
		document.head.append(s);
	});
	return loading;
}

/** a new <movi-player>, set up the way every use needs it */
export function newMovi() {
	const el = document.createElement('movi-player') as MoviElement;
	el.setAttribute('wasmurl', MOVI + 'movi.wasm');
	el.setAttribute('nohotkeys', '');
	el.setAttribute('buffersize', String(MOVI_MB));
	return el;
}
