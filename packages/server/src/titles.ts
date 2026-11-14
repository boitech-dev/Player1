// Titles as TMDB and Cinemeta describe them, turned into the cards the app shows. Pure: no
// settings, no storage, so it is tested on its own.
import type {
	Item,
	MediaType,
	Progress,
} from '@player1/shared/api';

export const IMG = 'https://image.tmdb.org/t/p/';
export const CM = 'https://v3-cinemeta.strem.io';

/** a TMDB film or show, as lists, searches and title pages give it */
export interface TmdbTitle {
	id: number;
	media_type?: string;
	title?: string;
	name?: string;
	original_title?: string;
	original_name?: string;
	original_language?: string;
	release_date?: string;
	first_air_date?: string;
	poster_path?: string | null;
	backdrop_path?: string | null;
	overview?: string;
	genre_ids?: number[];
	genres?: { id: number; name: string }[];
	/** merged in here: the English title */
	en?: string;
	/** merged in here: the romanized original (title pages only) */
	romaji?: string;
}

/** a Cinemeta title (when there is no TMDB key) */
export interface CmMeta {
	id: string;
	imdb_id?: string;
	type: MediaType;
	name: string;
	releaseInfo?: string;
	poster?: string;
	background?: string;
	description?: string;
}

export const norm = (s?: string) => (s || '').toLowerCase()
	.normalize('NFD')
	.replace(/[^a-z0-9]/g, '');
export const latin = (s?: string) => !/[^\p{Script=Latin}\p{N}\p{P}\p{S}\s]/u.test(s || '');
export const yearOf = (r: TmdbTitle) => (r.release_date || r.first_air_date || '').slice(0, 4);

// names: the original title first (romanized when it's in another script), then English if the
// original isn't English, else French: { title, sub }. r.en = English title, r.romaji =
// romanized original (title pages only).
export function names(r: TmdbTitle) {
	const original = r.original_title || r.original_name, fr = r.title || r.name, en = r.en;
	const title = (latin(original) ? original : r.romaji || en || fr) ?? '';
	const sub = [r.original_language !== 'en' && en, fr]
		.find((x): x is string => !!x && latin(x) && norm(x) !== norm(title));
	return {
		title,
		sub,
	};
}

export const fromTmdb = (r: TmdbTitle, t = r.media_type): Item => ({
	id: `tmdb:${r.id}`,
	type: t === 'tv' ? 'series' : 'movie',
	...names(r),
	year: yearOf(r),
	poster: r.poster_path ? IMG + 'w342' + r.poster_path : undefined,
	backdrop: r.backdrop_path ? IMG + 'w1280' + r.backdrop_path : undefined,
	overview: r.overview,
	anime: r.original_language === 'ja'
		&& (r.genre_ids || r.genres?.map(g => g.id) || []).includes(16),
});
export const fromCm = (m: CmMeta): Item => ({
	id: m.imdb_id || m.id,
	type: m.type,
	title: m.name,
	year: (m.releaseInfo || '').slice(0, 4),
	poster: m.poster,
	backdrop: m.background,
	overview: m.description,
});

// --- catalog rows: home shelves, and the endless grid behind each "See all" ---
export type TmdbKind = 'movie' | 'tv';
export interface CatSpec {
	path: string;
	t: TmdbKind;
	params?: Record<string, string | number>;
	/** a genre row: its TMDB genre id */
	genre?: number;
}
const ANIME = {
	with_genres: 16,
	with_original_language: 'ja',
	sort_by: 'popularity.desc',
};
export const CATS: Record<string, CatSpec> = {
	'trending-movie': {
		path: '/trending/movie/week',
		t: 'movie',
	},
	'trending-tv': {
		path: '/trending/tv/week',
		t: 'tv',
	},
	'anime-tv': {
		path: '/discover/tv',
		t: 'tv',
		params: ANIME,
	},
	'anime-movie': {
		path: '/discover/movie',
		t: 'movie',
		params: ANIME,
	},
	'top-movie': {
		path: '/movie/top_rated',
		t: 'movie',
	},
	'top-tv': {
		path: '/tv/top_rated',
		t: 'tv',
	},
};
/** a row key: one of CATS, or genre-<movie|tv>-<id> */
export function catSpec(key = ''): CatSpec | undefined {
	const g = /^genre-(movie|tv)-(\d+)$/.exec(key);
	if (!g) return Object.hasOwn(CATS, key) ? CATS[key] : undefined;
	const t = g[1] === 'tv' ? 'tv' : 'movie';
	return {
		t,
		path: `/discover/${t}`,
		params: {
			with_genres: g[2]!,
			sort_by: 'popularity.desc',
			'vote_count.gte': 50,
		},
		genre: +g[2]!,
	};
}

/** a show's seasons as TMDB lists them, the specials as season 0 */
export interface TmdbShow { seasons: { season_number: number; episode_count: number }[] }
const aired = (show: TmdbShow) => show.seasons
	.filter(x => x.season_number > 0 && x.episode_count > 0);
/** the episode after this one: the next in its season, else the first of the season after */
export function nextEp(show: TmdbShow, s: number, e: number) {
	const here = aired(show).find(x => x.season_number === s);
	const later = aired(show).find(x => x.season_number > s);
	if (here && e < here.episode_count) return {
		s,
		e: e + 1,
	};
	return later && {
		s: later.season_number,
		e: 1,
	};
}
/** the episode before this one: the previous in its season, else the last of the season before */
export function prevEp(show: TmdbShow, s: number, e: number) {
	if (e > 1) return {
		s,
		e: e - 1,
	};
	const before = aired(show).findLast(x => x.season_number < s);
	return before && {
		s: before.season_number,
		e: before.episode_count,
	};
}

/**
 * Where "Resume" cannot go on: the entry each series was played last (its key), when that episode
 * is finished and nothing says which one comes after. The web app's standing() reads the same
 * entry.
 */
export function deadEnds(progress: Record<string, Progress> = {}) {
	const last = new Map<string, [string, Progress]>();
	for (const x of Object.entries(progress)) {
		const id = x[1].id;
		if (id && x[1].at >= (last.get(id)?.[1].at ?? 0)) last.set(id, x);
	}
	return [...last.values()].filter(([, p]) => p.e && p.watched && !p.next).map(([key]) => key);
}

// --- age ratings: TMDB's per country, [country, rating] ---
export type Certs = [string, string][];
const NAMED: Record<string, number> = {
	G: 0,
	U: 0,
	TP: 0,
	'TV-Y': 0,
	'TV-G': 0,
	PG: 10,
	'TV-PG': 10,
	R: 17,
	'TV-MA': 17,
};
const ageIn = (r: string) =>
	/\d/.test(r) ? parseInt(r.replace(/^\D+/, '')) : NAMED[r.toUpperCase()];
/** the age a title is rated for: where the profile lives (FR, US), else in the US, else anywhere;
 *  the number a rating carries (12, PG-13, TV-14), or a known name's (PG, R). Its rating's own name
 *  only when it's from where the profile lives: elsewhere's (TV-PG for a French profile) means
 *  nothing there */
export function ratingOf(certs: Certs, home: string) {
	const known = certs.filter(([, r]) => ageIn(r) !== undefined);
	const at = (c: string) => known.find(([x]) => x === c);
	const [country, rating] = at(home) ?? at('US') ?? known[0] ?? [];
	return rating === undefined ? undefined : {
		rating: country === home ? rating : undefined,
		age: ageIn(rating)!,
	};
}
/** under a profile's max age, or unrated where it lets those through */
export const suits = (age: number | undefined, p: { maxAge?: number; unrated?: boolean }) =>
	p.maxAge == null || (age == null ? !!p.unrated : age <= p.maxAge);
