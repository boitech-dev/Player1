import {
	describe,
	expect,
	it,
} from 'vitest';

import {
	catSpec,
	fromTmdb,
	names,
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
