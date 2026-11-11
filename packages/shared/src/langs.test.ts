import {
	describe,
	expect,
	it,
} from 'vitest';

import {
	candidates,
	choosableTiers,
	pickTracks,
	type PresetLang,
	resOf,
	seedsOf,
	type StreamTag,
	tagStream,
	tierAlone,
	tiersOf,
	tierTag,
} from './langs.ts';

const tags = (l: PresetLang[]) => choosableTiers(l).map(tierTag);

describe('presets become tiers, in the order a profile tries them', () => {
	it('follows the spoken languages, then English subtitles, then the original', () => {
		expect(tags([{ code: 'fr' }])).toEqual(['VF', 'VOSTFR', 'VOSTEN', 'VOST']);
		expect(tags([{ code: 'en' }])).toEqual(['VE', 'VOSTEN', 'VOST']);
		expect(tags([{ code: 'fr' }, { code: 'es' }, { code: 'en' }]))
			.toEqual(['VF', 'VS', 'VE', 'VOSTFR', 'VOSTSP', 'VOSTEN', 'VOST']);
	});
	it('never dubs a captioned language', () => {
		expect(tags([{ code: 'fr' }, {
			code: 'en',
			captioned: true,
		}])).toEqual(['VF', 'VOSTFR', 'VOSTEN', 'VOST']);
		expect(tags([{
			code: 'en',
			captioned: true,
		}])).toEqual(['VOSTEN', 'VOST']);
	});
	it('tries OpenSubtitles after embedded subtitles, and the bare original last', () => {
		expect(tiersOf([{ code: 'fr' }]))
			.toEqual(['dub:fr', 'sub:fr', 'ext:fr', 'sub:en', 'ext:en', 'sub:orig', 'vo']);
		expect(tierAlone('sub:fr')).toEqual(['sub:fr', 'ext:fr']);
		expect(tierAlone('dub:fr')).toEqual(['dub:fr']);
	});
});

describe('release names', () => {
	it('reads the languages a release advertises', () => {
		expect(tagStream('Interstellar.2014.MULTi.1080p.BluRay.x264-LOST')).toEqual({
			a: ['fr'],
			s: [],
		});
		expect(tagStream('Interstellar.2014.TRUEFRENCH.BRRip.XviD')).toEqual({
			a: ['fr'],
			s: [],
		});
		expect(tagStream('INTERSTELLAR.2014.FANSUB.VOSTFR.BDRIP')).toEqual({
			a: [],
			s: ['fr'],
		});
		expect(tagStream('Interstellar 2014 2160p / Multi Audio / 🇬🇧 / 🇫🇷').a.sort())
			.toEqual(['en', 'fr']);
		expect(tagStream('Interstellar.2014.SPANISH.1080p')).toEqual({
			a: ['es'],
			s: [],
		});
	});
	it('ignores names that only look like languages', () => {
		const none = {
			a: [],
			s: [],
		};
		expect(tagStream('Interstellar.2014.1080p.BluRay.x264-SPARKS')).toEqual(none);
		expect(tagStream('Frenchie.Movie.2020.1080p')).toEqual(none);
	});
	it('reads resolution and seeders', () => {
		expect(resOf('Torrentio\n4k HDR')).toBe(2160);
		expect(resOf('Torrentio\nBDRip')).toBe(360);
		expect(seedsOf('x\n👤 146 💾 16.87 GB')).toBe(146);
	});
});

describe('tracks', () => {
	const audio = [{
		id: 'eng1',
		iso: 'eng',
	}, {
		id: 'fre1',
		iso: 'fre',
	}];
	const subs = [{
		id: 'fre1',
		iso: 'fre',
		label: 'French (Forced)',
	}, {
		id: 'fre2',
		iso: 'fre',
		label: 'French',
	}, {
		id: 'eng1',
		iso: 'eng',
	}];
	const pick = (audio: string, sub: string) => ({
		audio,
		sub,
	});
	it('picks a dub, or the original as "VE"', () => {
		expect(pickTracks('dub:fr', audio, subs, 'en')).toEqual(pick('fre1', 'none'));
		expect(pickTracks('dub:en', audio, subs, 'en')).toEqual(pick('eng1', 'none'));
		expect(pickTracks('dub:fr', [{
			id: 'jpn1',
			iso: 'jpn',
		}], subs, 'ja')).toBeNull();
	});
	it('prefers full subtitles over forced ones', () => {
		expect(pickTracks('sub:fr', audio, subs, 'en')).toEqual(pick('eng1', 'fre2'));
		expect(pickTracks('sub:en', audio, subs, 'en')).toEqual(pick('eng1', 'eng1'));
		expect(pickTracks('sub:orig', audio, subs, 'en')).toEqual(pick('eng1', 'eng1'));
		expect(pickTracks('sub:en', audio, [], 'en')).toBeNull();
	});
	it('needs the original audio for subtitles', () => {
		const frJa = [{
			id: 'fre1',
			iso: 'fre',
		}, {
			id: 'jpn1',
			iso: 'jpn',
		}];
		expect(pickTracks('sub:fr', [frJa[0]!, audio[0]!], subs, 'ja')).toBeNull();
		expect(pickTracks('sub:fr', frJa, subs, 'ja')).toEqual(pick('jpn1', 'fre2'));
		expect(pickTracks('sub:fr', [{
			id: 'a1',
			iso: 'tha',
		}, {
			id: 'a2',
			iso: 'eng',
		}], subs, 'th')).toEqual(pick('a1', 'fre2'));
	});
	it('plays the original, not the dub, as a last resort', () => {
		expect(pickTracks('vo', audio, [], 'en')).toEqual(pick('eng1', 'none'));
	});
});

describe('candidates', () => {
	const s = (a: string[], sub: string[], res: number, seeds: number) => ({
		tag: {
			a,
			s: sub,
		} satisfies StreamTag,
		res,
		seeds,
	});
	const all = [
		s([], [], 1080, 5),
		s(['fr'], [], 2160, 3),
		s(['fr'], [], 1080, 9),
		s(['fr'], [], 720, 50),
		s([], ['fr'], 720, 1),
	];
	it('only takes advertised dubs, best first', () => {
		expect(candidates(all, 'dub:fr', 0, 'en').map(x => x.res)).toEqual([2160, 1080, 720]);
	});
	it('puts the device’s preferred quality first', () => {
		expect(candidates(all, 'dub:fr', 720, 'en').map(x => x.res)).toEqual([720, 1080, 2160]);
	});
	it('takes plain and multi-language releases for the original language', () => {
		expect(candidates(all, 'dub:en', 0, 'en')).toHaveLength(4);
	});
	it('takes subtitled releases first for subtitles', () => {
		expect(candidates(all, 'sub:fr', 0, 'en')[0]!.tag.s).toEqual(['fr']);
	});
});
