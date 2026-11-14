import {
	describe,
	expect,
	it,
} from 'vitest';

import {
	catSpec,
	deadEnds,
	fromTmdb,
	names,
	nextEp,
	prevEp,
	ratingOf,
	suits,
} from './titles.ts';

describe('names', () => {
	it('puts a Latin-script original first, then the English title', () => {
		expect(names({
			id: 1,
			original_title: 'Amélie',
			title: 'Le Fabuleux Destin d’Amélie Poulain',
			original_language: 'fr',
			en: 'Amélie',
		})).toEqual({
			title: 'Amélie',
			sub: 'Le Fabuleux Destin d’Amélie Poulain',
		});
	});
	it('romanizes an original in another script, and skips a repeat', () => {
		expect(names({
			id: 2,
			original_name: '進撃の巨人',
			name: 'L’Attaque des Titans',
			original_language: 'ja',
			en: 'Attack on Titan',
			romaji: 'Shingeki no Kyojin',
		})).toEqual({
			title: 'Shingeki no Kyojin',
			sub: 'Attack on Titan',
		});
		expect(names({
			id: 3,
			original_title: 'Dune',
			title: 'Dune',
			original_language: 'en',
			en: 'Dune',
		}).sub).toBeUndefined();
	});
	it('makes a card, anime when Japanese animation', () => {
		const card = fromTmdb({
			id: 4,
			name: 'Frieren',
			original_name: 'Frieren',
			original_language: 'ja',
			first_air_date: '2023-09-29',
			genre_ids: [16],
			poster_path: '/p.jpg',
		}, 'tv');
		expect(card).toMatchObject({
			id: 'tmdb:4',
			type: 'series',
			year: '2023',
			anime: true,
			poster: 'https://image.tmdb.org/t/p/w342/p.jpg',
		});
		expect(card.backdrop).toBeUndefined();
	});
});

describe('category keys', () => {
	it('name a picked row or a genre', () => {
		expect(catSpec('trending-tv')).toEqual({
			path: '/trending/tv/week',
			t: 'tv',
		});
		expect(catSpec('genre-movie-28')).toMatchObject({
			path: '/discover/movie',
			t: 'movie',
			genre: 28,
			params: { with_genres: '28' },
		});
		expect(catSpec('genre-anime-28')).toBeUndefined();
		expect(catSpec('toString')).toBeUndefined();
		expect(catSpec()).toBeUndefined();
	});
});

describe('the episodes around one', () => {
	// specials, two seasons, and one announced with no episode yet
	const show = {
		seasons: ([[0, 3], [1, 12], [2, 10], [3, 0]] as const).map(([season_number, episode_count]) => ({
			season_number,
			episode_count,
		})),
	};
	const at = (x?: { s: number; e: number }) => x && `${x.s}x${x.e}`;
	it('stay in the season, then cross to the one beside it', () => {
		expect(at(nextEp(show, 1, 4))).toBe('1x5');
		expect(at(nextEp(show, 1, 12))).toBe('2x1');
		expect(at(prevEp(show, 1, 5))).toBe('1x4');
		expect(at(prevEp(show, 2, 1))).toBe('1x12');
	});
	it('stop at both ends, the specials and empty seasons left out', () => {
		expect(prevEp(show, 1, 1)).toBeUndefined();
		expect(nextEp(show, 2, 10)).toBeUndefined();
	});
});

describe('where "Resume" cannot go on', () => {
	const ep = (e: number, at: number, more = {}) => ({
		id: 'tmdb:1',
		s: 1,
		e,
		pos: 1380,
		dur: 1470,
		watched: true,
		at,
		...more,
	});
	it('is the episode a series was left on, finished, with nothing noted after it', () => {
		expect(deadEnds({
			'tt1:1:2': ep(2, 20),
			'tt1:1:1': ep(1, 10),
		})).toEqual(['tt1:1:2']);
	});
	it('is not one still being watched, one that names the next, or a film', () => {
		expect(deadEnds({
			'tt1:1:1': ep(1, 10),
			'tt1:1:2': ep(2, 20, { watched: false }),
		})).toEqual([]);
		expect(deadEnds({
			'tt1:1:1': ep(1, 10, {
				next: {
					s: 1,
					e: 2,
				},
			}),
		})).toEqual([]);
		expect(deadEnds({
			tt2: {
				id: 'tmdb:2',
				pos: 6000,
				dur: 6200,
				watched: true,
				at: 5,
			},
		})).toEqual([]);
		expect(deadEnds()).toEqual([]);
	});
});

describe('ratingOf', () => {
	it('takes the home country, then the US, then any, and reads the age', () => {
		expect(ratingOf([['US', 'PG-13'], ['FR', '12']], 'FR')).toEqual({
			rating: '12',
			age: 12,
		});
		// another country's: its age, not its name
		expect(ratingOf([['FR', ''], ['US', 'TV-MA']], 'FR')).toEqual({
			rating: undefined,
			age: 17,
		});
		expect(ratingOf([['US', 'TV-MA']], 'US')?.rating).toBe('TV-MA');
		expect(ratingOf([['DE', '6']], 'US')?.age).toBe(6);
		expect(ratingOf([['US', 'NR'], ['GB', '']], 'US')).toBeUndefined();
	});
	it('holds a profile to its max age, unrated only when allowed', () => {
		expect(suits(17, {})).toBe(true);
		expect(suits(12, { maxAge: 12 })).toBe(true);
		expect(suits(13, { maxAge: 12 })).toBe(false);
		expect(suits(undefined, { maxAge: 12 })).toBe(false);
		expect(suits(undefined, {
			maxAge: 12,
			unrated: true,
		})).toBe(true);
	});
});
