import {
	describe,
	expect,
	it,
} from 'vitest';

import {
	outroFrom,
	outroIn,
} from './outro.ts';

/** chapters back to back: [title, start] pairs, the last one ending with the file */
const chapters = (dur: number, ...list: [string, number][]) => list.map(([title, at], i) => ({
	start_time: at.toFixed(6),
	end_time: (list[i + 1]?.[1] ?? dur).toFixed(6),
	tags: { title },
}));

describe('the outro a file marks', () => {
	it('starts at its end credits, however they are spelled', () => {
		// as Fargo S02E03 has them, a scene named after Ed included
		const fargo = chapters(
			2933,
			['Recap', 0],
			['Ed wonders if it worked', 2391],
			['End Credits', 2771],
		);
		expect(outroIn(fargo, 2933)).toEqual({
			from: 2771,
			to: 2933,
		});
		const spellings = ['ED', 'ED2', 'Ending', 'Credits', 'Closing Credits', 'Outro'];
		for (const title of [...spellings, 'Générique de fin', 'エンディング']) {
			expect(outroIn(chapters(1440, ['Part A', 0], [title, 1300]), 1440)?.from, title).toBe(1300);
		}
	});
	it('takes the preview that follows, and stops before a scene after the credits', () => {
		const anime = chapters(1440, ['OP', 0], ['Part B', 700], ['ED', 1290], ['Preview', 1380]);
		expect(outroIn(anime, 1440)).toEqual({
			from: 1290,
			to: 1440,
		});
		const scene = chapters(1560, ['Part B', 700], ['ED', 1290], ['Part C', 1380], ['Preview', 1545]);
		expect(outroIn(scene, 1560)).toEqual({
			from: 1290,
			to: 1380,
		});
	});
	it('is unknown without a name for it, or when the name comes too early', () => {
		expect(outroIn([], 1440)).toBeUndefined();
		expect(outroIn(undefined, 1440)).toBeUndefined();
		const numbered = chapters(1440, ['Chapter 1', 0], ['Chapter 2', 700], ['Chapter 3', 1300]);
		expect(outroIn(numbered, 1440)).toBeUndefined();
		const opening = chapters(1440, ['Opening', 0], ['Credits', 60], ['Episode', 150]);
		expect(outroIn(opening, 1440)).toBeUndefined();
		expect(outroIn(chapters(0, ['ED', 1300]), 0)).toBeUndefined();
	});
});

describe('the outro TheIntroDB knows', () => {
	// its real answer for a 24:30 episode
	const frieren = {
		group_duration_ms: 1470042,
		credits: [{
			start_ms: 1370127,
			end_ms: 1460096,
			submission_count: 13,
		}],
		preview: [{
			start_ms: 1460304,
			end_ms: null,
			submission_count: 3,
		}],
	};
	it('runs from the credits through the preview', () => {
		expect(outroFrom(frieren, 1470)).toEqual({
			from: 1370.127,
			to: 1470,
		});
	});
	it('is left alone for another cut of the episode', () => {
		expect(outroFrom(frieren, 1577)).toBeUndefined();
		expect(outroFrom(frieren, 0)).toBeUndefined();
	});
	it('needs two people to agree, and credits in the second half', () => {
		const one = {
			group_duration_ms: 1470042,
			credits: [{
				start_ms: 1370127,
				end_ms: null,
				submission_count: 1,
			}],
		};
		expect(outroFrom(one, 1470)).toBeUndefined();
		const early = {
			group_duration_ms: 1470042,
			credits: [{
				start_ms: 90000,
				end_ms: 180000,
				submission_count: 9,
			}],
		};
		expect(outroFrom(early, 1470)).toBeUndefined();
		expect(outroFrom({ group_duration_ms: 1470042 }, 1470)).toBeUndefined();
	});
	it('ends where the story picks up again', () => {
		const scene = {
			group_duration_ms: 1560000,
			credits: [{
				start_ms: 1290000,
				end_ms: 1380000,
				submission_count: 6,
			}],
		};
		expect(outroFrom(scene, 1560)).toEqual({
			from: 1290,
			to: 1380,
		});
	});
});
