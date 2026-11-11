// external subtitles (SRT from OpenSubtitles), drawn over the video by the page

export interface Cue {
	/** start and end, seconds */
	s: number;
	e: number;
	/** escaped text; only <i> and line breaks survive */
	html: string;
}

const esc = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const time = (h = '0', m = '0', s = '0', ms = '0') => +h * 3600 + +m * 60 + +s + +ms / 1000;
const CUE = /(\d+):(\d+):(\d+)[,.](\d+) --> (\d+):(\d+):(\d+)[,.](\d+)[^\n]*\n([\s\S]*)/;

export const parseSrt = (txt: string): Cue[] => txt
	.replace(/\r/g, '')
	.split(/\n\n+/)
	.flatMap(block => {
		const m = CUE.exec(block);
		if (!m) return [];
		const text = (m[9] ?? '').trim().replace(/<(?!\/?i>)[^>]*>|\{[^}]*\}/g, '');
		return [{
			s: time(m[1], m[2], m[3], m[4]),
			e: time(m[5], m[6], m[7], m[8]),
			html: esc(text).replace(/&#60;(\/?)i&#62;/g, '<$1i>').replace(/\n/g, '<br>'),
		}];
	});

/** the cue showing at time t */
export const cueAt = (cues: Cue[], t: number) => cues.find(c => t >= c.s && t <= c.e)?.html ?? '';
