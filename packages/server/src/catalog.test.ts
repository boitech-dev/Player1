import {
	expect,
	test,
} from 'vitest';

import { rankTrailers } from './catalog.ts';

const v = (key: string, iso_639_1: string, name: string, type = 'Trailer') => ({
	site: 'YouTube',
	type,
	key,
	name,
	iso_639_1,
	official: true,
});
const videos = [
	v('en', 'en', 'Official Trailer'),
	v('vost', 'fr', 'Bande-annonce VOST'),
	v('vostfr', 'fr', 'Bande-annonce officielle [VOSTFR]'),
	v('teaser', 'fr', 'Teaser VF', 'Teaser'),
	v('vf', 'fr', 'Bande-annonce VF'),
	v('clip', 'fr', 'Extrait', 'Clip'),
];

test('trailers follow the preset: French then English subtitles', () => {
	expect(rankTrailers(videos, [{ code: 'fr' }, {
		code: 'en', captioned: true, 
	}]))
		.toEqual(['vf', 'teaser', 'vost', 'vostfr', 'en']);
});

test('trailers follow the preset: French subtitles only', () => {
	expect(rankTrailers(videos, [{
		code: 'fr', captioned: true, 
	}]))
		.toEqual(['vost', 'vostfr', 'en', 'vf', 'teaser']);
});
