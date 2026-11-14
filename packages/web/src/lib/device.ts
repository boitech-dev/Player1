import { t } from '@lingui/core/macro';

import {
	type Format,
	FORMATS,
} from '@player1/shared/release';

import {
	keep,
	keepJSON,
	load,
	loadJSON,
} from './store.ts';

// --- this device ---

const ua = navigator.userAgent;
/** the Android TV app (the page inside its WebView) */
export const tvApp = /Player1TV/.test(ua);
/** an LG TV: its own <video> plays files (MKV, HEVC, AV1, HDR) on the TV's video chip */
export const webOS = /Web0S|webOS/.test(ua);
/** a TV, where the page may play sound before the remote is touched */
export const tv = tvApp || webOS;
/** phones and tablets: no automatic focus rings */
export const touch = matchMedia('(pointer: coarse)').matches;

const guess = () => {
	if (tvApp) return t`Projector`;
	if (webOS) return t`LG TV`;
	if (/iPhone/.test(ua)) return t`iPhone`;
	if (/iPad/.test(ua)) return t`iPad`;
	if (/Android/.test(ua)) return t`Phone`;
	return t`PC`;
};

function deviceId() {
	const id = load('dev');
	if (id) return id;
	const made = Math.random().toString(36).slice(2);
	keep('dev', made);
	return made;
}

let name = load('devname');

/** how this device appears to the others (its default name in the interface's language) */
export const me = {
	id: deviceId(),
	get name() {
		return name ?? guess();
	},
};

export function rename(n: string) {
	name = n;
	keep('devname', n);
}

// --- what it plays: each device decodes (and draws) a few seconds of a film in each format at full speed
// and keeps the formats it handles with a margin; its own overrides come on top. Until tested, the
// browser's claims stand in. ---

// LG TVs: 6 replaced the Movi test (0.3x on H.264) with the TV's own player, 7 stopped timing the start and the
// switch to HDR; results from older tests are dropped and the TV tests again
export const CAPS_VERSION = webOS ? 7 : 5;

/** a format's name in English, as test results keep it */
export const FORMAT_NAME: Record<Format, string> = {
	h264: 'H.264 1080p, Blu-ray bitrate',
	hevc10: 'HEVC 10-bit 1080p',
	'4k': 'HEVC 10-bit 4K HDR',
	av1: 'AV1 1080p',
};

/** a format's name, in the interface's language */
export function formatName(k: Format) {
	switch (k) {
		case 'h264': return t`H.264 1080p, Blu-ray bitrate`;
		case 'hevc10': return t`HEVC 10-bit 1080p`;
		case '4k': return t`HEVC 10-bit 4K HDR`;
		default: return t`AV1 1080p`;
	}
}

/** one format's test result */
export interface FormatResult {
	name?: string;
	ok: boolean;
	why?: string;
	speed?: number;
	smooth?: number;
	stalls?: number;
	redraw?: number;
	dropped?: number;
	native?: boolean;
	/** found too slow while playing a film */
	lagged?: boolean;
}

export interface Caps {
	v: number;
	at: number;
	/** Mbit/s from this server */
	net: number;
	results: Partial<Record<Format, FormatResult>>;
}

let caps: Caps | null = (() => {
	const c = loadJSON<Caps>('caps');
	return c?.v === CAPS_VERSION ? c : null;
})();

export const getCaps = () => caps;
export function setCaps(c: Caps | null) {
	caps = c;
	keepJSON('caps', c);
}

export type Override = 'on' | 'off';
/** per format, plus 'direct' (play original files): absent = automatic */
export type Overrides = Partial<Record<Format | 'direct', Override>>;
export const overrides = (): Overrides => loadJSON<Overrides>('hwover') ?? {};
export const setOverrides = (o: Overrides) => keepJSON('hwover', o);

// the browser's word, only until the device is tested
const claimed = (async () => {
	const has = async (codec: string) => {
		try {
			return !!(await VideoDecoder.isConfigSupported({
				codec,
				codedWidth: 1920,
				codedHeight: 1080,
			})).supported;
		} catch {
			return false;
		}
	};
	const out: Format[] = ['h264'];
	if (await has('hvc1.2.4.L120.90')) out.push('hevc10');
	if (await has('av01.0.08M.08')) out.push('av1');
	return out;
})();

/** the formats this device plays from the original file, its overrides applied: "h264,hevc10" */
export async function hwList() {
	const o = overrides();
	const base = caps ? FORMATS.filter(k => caps!.results[k]?.ok) : await claimed;
	return FORMATS.filter(k => o[k] === 'on' || (o[k] !== 'off' && base.includes(k))).join(',');
}

/** phones: originals are heavy on mobile data */
export const directAuto = () => webOS || (!touch && 'VideoDecoder' in window);
export const directOn = () => {
	const o = overrides().direct;
	return o ? o === 'on' : directAuto();
};

/** the device's preferred resolution, 0 = the best available */
export const preferredQuality = () => Number(load('quality')) || 0;
