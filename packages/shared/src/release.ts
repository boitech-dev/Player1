// What a device can play, by format. Each device measures the formats it plays smoothly (the
// device test) and reports them as `hw`; files are only sent to its own decoder when it can.

/** the formats a device is tested on, lightest first */
export const FORMATS = ['h264', 'hevc10', '4k', 'av1'] as const;
export type Format = (typeof FORMATS)[number];

/** a clip of the device test: a few seconds in one of the formats */
export interface TestClip {
	key: Format;
	name: string;
	/** what the browser is asked before it tries (VideoDecoder.isConfigSupported) */
	codec: string;
	width: number;
	height: number;
	fps: number;
}

export const RES_LABEL: Record<number, string> = {
	2160: '4K',
	1440: '1440p',
	1080: '1080p',
	720: '720p',
	480: '480p',
	360: 'SD',
};

/** a video stream as ffprobe sees it */
export interface VideoInfo {
	codec: string;
	bits: number;
	height: number;
}

/** from a release name, the way the server reads it: '10' when it says 10-bit */
export const codecOf = (t: string) => {
	const ten = /10.?bits?|hi10|main.?10/i.test(t);
	if (/\bAV1\b/i.test(t)) return 'av1';
	if (/x265|hevc|h\.?265/i.test(t)) return ten ? 'hevc10' : 'hevc';
	return ten ? 'h264-10' : 'h264';
};

const hwList = (hw: string | string[] = '') => typeof hw === 'string' ? hw.split(',') : hw;

/**
 * Whether a device decodes this video itself: 8-bit H.264 always if it plays H.264, anything else
 * only if it measured itself playing it well. 4K needs its own test.
 */
export function hwDecodes(vid: VideoInfo | null | undefined, hw: string | string[] = '') {
	if (!vid) return false;
	const has = hwList(hw);
	if (vid.height > 1200 && !has.includes('4k')) return false;
	if (vid.codec === 'h264') return vid.bits === 8 && has.includes('h264');
	// its test sample is 10-bit: 8-bit is lighter
	if (vid.codec === 'hevc') return has.includes('hevc10');
	return vid.codec === 'av1' && has.includes('av1');
}

/** the same answer from a release name and resolution, before anything is probed */
export const canName = (title: string, res: number, hw: string | string[] = '') => {
	const c = codecOf(title || '');
	return hwDecodes({
		codec: c.replace(/-?10$/, ''),
		bits: /10$/.test(c) ? 10 : 8,
		height: res >= 2160 ? 2160 : 1080,
	}, hw);
};
