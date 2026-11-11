import {
	describe,
	expect,
	it,
} from 'vitest';

import {
	cueAt,
	parseSrt,
} from './srt.ts';

const SRT = `1\r\n00:00:01,000 --> 00:00:02,500\r\nHello <b>there</b>\r\n<i>friend</i>\r\n\r\n2
00:01:00.250 --> 00:01:01.000 X1:0\n{\\an8}<script>x</script> & co\n`;

describe('SRT subtitles', () => {
	const cues = parseSrt(SRT);
	it('reads every cue with its times', () => {
		expect(cues).toHaveLength(2);
		expect(cues[0]).toMatchObject({
			s: 1,
			e: 2.5,
		});
		expect(cues[1]!.s).toBeCloseTo(60.25);
	});
	it('keeps italics and line breaks, escapes the rest', () => {
		expect(cues[0]!.html).toBe('Hello there<br><i>friend</i>');
		expect(cues[1]!.html).toBe('x &#38; co');
	});
	it('finds the cue at a moment', () => {
		expect(cueAt(cues, 2)).toBe(cues[0]!.html);
		expect(cueAt(cues, 30)).toBe('');
	});
});
