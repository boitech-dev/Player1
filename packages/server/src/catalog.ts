// The catalog: TMDB (in the profile's language, English titles merged in) or Cinemeta without a
// TMDB key. Home shelves, the endless grid behind each "See all", genres, the discover deck,
// search, title pages and trailers.
import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';

import type {
	Episode,
	Genre,
	Item,
	Meta,
	Row,
	Season,
} from '@player1/shared/api';

import {
	activePreset,
	me,
} from './db.ts';
import type { GetHandlers } from './http.ts';
import {
	lang,
	t,
	UserError,
} from './i18n.ts';
import {
	CATS,
	catSpec,
	CM,
	type CmMeta,
	fromCm,
	fromTmdb,
	IMG,
	latin,
	norm,
	type TmdbKind,
	type TmdbTitle,
	yearOf,
} from './titles.ts';
import {
	getJSON,
	hasTmdb,
	memo,
	type Params,
	tmdb,
} from './upstream.ts';

interface TmdbPage {
	page: number;
	total_pages: number;
	results: TmdbTitle[];
}

// TMDB in French (overviews, French titles) with the English titles merged in from a second call
const tmdbEn = async (path: string, params: Params = {}) => {
	const [fr, en] = await Promise.all([
		tmdb<TmdbPage>(path, params),
		tmdb<TmdbPage>(path, {
			...params,
			language: 'en-US',
		}).catch((): Pick<TmdbPage, 'results'> => ({ results: [] })),
	]);
	const byId = new Map(en.results.map(x => [x.id, x.title || x.name]));
	return {
		...fr,
		results: fr.results.map(x => ({
			...x,
			en: byId.get(x.id),
		})),
	};
};

const TITLES: Record<string, MessageDescriptor> = {
	'trending-movie': msg`Trending movies`,
	'trending-tv': msg`Trending series`,
	'anime-tv': msg`Anime`,
	'anime-movie': msg`Japanese animated films`,
	'top-movie': msg`Top rated movies`,
	'top-tv': msg`Top rated series`,
};
const titleOf = (key: string) => {
	const d = TITLES[key];
	return d ? t(d) : key;
};
const genres = () => memo(`genres:${lang()}`, async () => ({
	movie: (await tmdb<{ genres: Genre[] }>('/genre/movie/list')).genres,
	tv: (await tmdb<{ genres: Genre[] }>('/genre/tv/list')).genres,
}));
async function genreTitle(kind: TmdbKind, id: number) {
	const genre = (await genres())[kind].find(x => x.id === id)?.name || 'Genre';
	return t(kind === 'tv' ? msg`${genre}: series` : msg`${genre}: movies`);
}
async function category(key: string, page = 1): Promise<Row> {
	const spec = catSpec(key);
	if (!spec) throw new UserError(msg`Unknown category`);
	const title = spec.genre ? await genreTitle(spec.t, spec.genre) : titleOf(key);
	const r = await tmdbEn(spec.path, {
		...spec.params,
		page,
	});
	return {
		key,
		title,
		items: r.results.map(x => fromTmdb(x, spec.t)),
		more: r.page < Math.min(r.total_pages, 500),
	};
}

// artwork per tile: its 3 most popular titles, never reusing a title another tile already shows
const artOf = (keys: string[]) => memo(`catart:${lang()}`, async () => {
	const rows = await Promise.all(keys.map(k => category(k).catch(() => null)));
	const used = new Set<string>();
	return Object.fromEntries(keys.map((k, i) => {
		const items = (rows[i]?.items || []).filter(x => x.poster && x.backdrop);
		const unused = items.filter(x => !used.has(x.id));
		const pick = (unused.length >= 3 ? unused : items).slice(0, 3);
		pick.forEach(x => used.add(x.id));
		return [k, {
			backdrop: pick[0]?.backdrop?.replace('/w1280/', '/w780/'),
			posters: pick.map(x => x.poster?.replace('/w342/', '/w185/') ?? ''),
		}];
	}));
});

// --- discover: recommendations from what was kept or favourited, topped up with popular titles;
// never shows a title twice ---
const ANIME = {
	with_genres: 16,
	with_original_language: 'ja',
};
const POOLS: Record<string, [TmdbKind, Params][]> = {
	all: [['movie', {}], ['tv', {}]],
	movie: [['movie', {}]],
	series: [['tv', { without_genres: 16 }]],
	anime: [['tv', ANIME], ['movie', ANIME]],
};
const shuffle = <T>(xs: T[]) => xs.sort(() => Math.random() - .5);
const fits = (kind: string, i: Item) => kind === 'all'
	|| (kind === 'anime' ? !!i.anime : !i.anime && i.type === (kind === 'movie' ? 'movie' : 'series'));

async function discover(kind = 'all') {
	const p = me(), seen = p.seen ||= {}, lists = Object.values(p.lists).flat();
	const inLists = new Set(lists.map(x => x.type + x.id));
	const liked = shuffle(lists.filter(x => x.id.startsWith('tmdb:'))).slice(0, 4);
	const rnd = () => 1 + Math.floor(Math.random() * 10);
	const pools = Object.hasOwn(POOLS, kind) ? POOLS[kind] ?? [] : [];
	const found = await Promise.all([
		...liked.map(x => {
			const k = x.type === 'series' ? 'tv' : 'movie';
			return tmdbEn(`/${k}/${x.id.slice(5)}/recommendations`)
				.then(r => r.results.map(z => fromTmdb(z, k)), () => []);
		}),
		...pools.map(([k, params]) => tmdbEn(`/discover/${k}`, {
			sort_by: 'popularity.desc',
			'vote_count.gte': 300,
			page: rnd(),
			...params,
		}).then(r => r.results.map(z => fromTmdb(z, k)), () => [])),
	]);
	const out = new Map<string, Item>();
	const snoozed = (k: string) => (p.snooze?.[k] ?? 0) > Date.now();
	const fresh = (k: string) => !(k in seen) && !snoozed(k) && !inLists.has(k);
	for (const i of found.flat()) {
		if (i.backdrop && i.poster && fits(kind, i) && fresh(i.type + i.id)) out.set(i.type + i.id, i);
	}
	return shuffle([...out.values()]).slice(0, 20);
}

// --- search ---
interface CmPage { metas: CmMeta[] }
const tmdbSearch = (query: string, language: string) => tmdb<TmdbPage>('/search/multi', {
	query,
	language,
}).then(r => r.results, (): TmdbTitle[] => []);
const cmSearch = (type: string, q: string) => getJSON<CmPage>(
	`${CM}/catalog/${type}/top/search=${encodeURIComponent(q)}.json`,
).then(r => r.metas, (): CmMeta[] => []);
// English search only matches English titles: look up the English name of non-Latin originals
// directly
const englishNames = (hits: TmdbTitle[]) => Promise.all(hits
	.filter(r => !r.en && !latin(r.original_title || r.original_name))
	.slice(0, 10)
	.map(r => tmdb<TmdbTitle>(`/${r.media_type}/${r.id}`, { language: 'en-US' }).then(d => {
		r.en = d.title || d.name;
	}, () => {})));
const allNames = (r: TmdbTitle, e?: TmdbTitle) => [
	r.title,
	r.name,
	r.original_title,
	r.original_name,
	e?.title,
	e?.name,
].filter(x => x !== undefined);

async function search(q = '') {
	const cm = Promise.all([cmSearch('movie', q), cmSearch('series', q)]);
	const tm = hasTmdb
		? Promise.all([tmdbSearch(q, 'fr-FR'), tmdbSearch(q, 'en-US')])
		: [[], []] as const;
	const [[fr, en], cms] = await Promise.all([tm, cm]);
	const enOf = (r: TmdbTitle) => en.find(x => x.id === r.id);
	const hits = fr.filter(r => r.media_type !== 'person').map(r => ({
		...r,
		en: enOf(r)?.[r.media_type === 'tv' ? 'name' : 'title'],
	}));
	await englishNames(hits);
	const out = hits.map(r => fromTmdb(r));
	// ponytail: dedupe by title+year across fr/en/original titles; an imdb-id lookup per result
	// would be exact but N extra calls
	const seen = new Set(fr.flatMap(r => allNames(r, enOf(r)).map(x => norm(x) + yearOf(r))));
	const fresh = (m: CmMeta) => !seen.has(norm(m.name) + (m.releaseInfo || '').slice(0, 4));
	for (const m of cms.flat()) if (norm(m.name).includes(norm(q)) && fresh(m)) out.push(fromCm(m));
	return out;
}

// --- title pages ---
interface TmdbDetails extends TmdbTitle {
	external_ids?: { imdb_id?: string };
	translations?: {
		translations: {
			iso_639_1: string;
			iso_3166_1: string;
			data?: { title?: string; name?: string };
		}[];
	};
	alternative_titles?: {
		results?: { type: string; title: string }[];
		titles?: { type: string; title: string }[];
	};
	runtime?: number;
	episode_run_time?: number[];
	seasons?: { season_number: number; name: string; episode_count: number }[];
}
const englishTitle = (m: TmdbDetails) => {
	const en = m.translations?.translations
		.find(x => x.iso_639_1 === 'en' && x.iso_3166_1 === 'US')?.data;
	return en?.title || en?.name || undefined;
};
const romaji = (m: TmdbDetails) => {
	const alt = m.alternative_titles?.results || m.alternative_titles?.titles || [];
	return alt.find(x => /^romaji$/i.test(x.type))?.title
		|| alt.find(x => /romani[sz]ation/i.test(x.type))?.title;
};
async function tmdbMeta(type: string, id: string): Promise<Meta> {
	const k = type === 'series' ? 'tv' : 'movie';
	const more = 'external_ids,translations,alternative_titles';
	const m = await tmdb<TmdbDetails>(`/${k}/${id.slice(5)}`, { append_to_response: more });
	m.en = englishTitle(m);
	m.romaji = romaji(m);
	return {
		...fromTmdb(m, k),
		overview: m.overview,
		backdrop: m.backdrop_path ? IMG + 'w1280' + m.backdrop_path : undefined,
		imdb: m.external_ids?.imdb_id,
		lang: m.original_language,
		genres: m.genres?.map(g => g.name),
		runtime: m.runtime || m.episode_run_time?.[0],
		seasons: m.seasons?.filter(x => x.season_number > 0).map(x => ({
			n: x.season_number,
			name: x.name,
			count: x.episode_count,
		})),
	};
}
interface CmVideo {
	season?: number;
	episode?: number;
	number?: number;
	name?: string;
	title?: string;
	thumbnail?: string;
	overview?: string;
}
interface CmDetails extends CmMeta { videos?: CmVideo[]; genres?: string[]; runtime?: string }
async function cmMeta(type: string, id: string): Promise<Meta> {
	const { meta: m } = await getJSON<{ meta: CmDetails }>(`${CM}/meta/${type}/${id}.json`);
	const seasons: Record<number, Episode[]> = {};
	for (const v of m.videos || []) if (v.season && v.season > 0) (seasons[v.season] ||= []).push({
		e: v.episode ?? v.number ?? 0,
		title: v.name || v.title || '',
		still: v.thumbnail,
		overview: v.overview,
	});
	const list = Object.entries(seasons).map(([n, episodes]): Season => ({
		n: +n,
		name: t(msg`Season ${n}`),
		episodes,
	}));
	return {
		...fromCm(m),
		imdb: m.imdb_id || m.id,
		lang: null,
		genres: m.genres,
		runtime: parseInt(m.runtime ?? '') || null,
		seasons: type === 'series' ? list : undefined,
	};
}

interface TmdbVideo {
	site: string;
	type: string;
	key: string;
	iso_639_1?: string;
	official?: boolean;
}
// a YouTube trailer for a TMDB title: French first when the viewer watches dubbed, else
// English/original
async function trailer(type?: string, id = '') {
	if (!/^tmdb:\d+$/.test(id)) return {};
	const dub = activePreset().langs.find(l => !l.captioned)?.code || 'en'; // the first language the profile listens to
	const where = `/${type === 'series' ? 'tv' : 'movie'}/${id.slice(5)}/videos`;
	const query = { include_video_language: `${dub},en,null` };
	const { results = [] } = await tmdb<{ results?: TmdbVideo[] }>(where, query);
	const spoken = (v: TmdbVideo) => v.iso_639_1 === dub ? 8 : v.iso_639_1 === 'en' ? 4 : 0;
	const kind = (v: TmdbVideo) => v.type === 'Trailer' ? 4 : v.type === 'Teaser' ? 2 : 0;
	const score = (v: TmdbVideo) => kind(v) + spoken(v) + (v.official ? 1 : 0);
	const best = results.filter(v => v.site === 'YouTube' && /Trailer|Teaser/.test(v.type))
		.sort((a, b) => score(b) - score(a))[0];
	return best ? { key: best.key } : {};
}

interface TmdbSeason {
	episodes: {
		episode_number: number;
		name: string;
		overview?: string;
		still_path?: string | null;
		runtime?: number;
	}[];
}

export const catalogGets: GetHandlers = {
	home: async () => {
		if (!hasTmdb) {
			const [m, s] = await Promise.all([
				getJSON<CmPage>(`${CM}/catalog/movie/top.json`),
				getJSON<CmPage>(`${CM}/catalog/series/top.json`),
			]);
			return [
				{
					title: t(msg`Popular movies`),
					items: m.metas.map(fromCm),
				},
				{
					title: t(msg`Popular series`),
					items: s.metas.map(fromCm),
				},
			];
		}
		return Promise.all(Object.keys(CATS).map(k => category(k)));
	},
	browse: ({ key = '', page }) => category(key, Number(page) || 1),
	genres: async () => {
		const g = await genres();
		const keys = [
			...Object.keys(CATS),
			...g.movie.map(x => `genre-movie-${x.id}`),
			...g.tv.map(x => `genre-tv-${x.id}`),
		];
		return {
			...g,
			cats: Object.keys(CATS).map(key => ({
				key,
				title: titleOf(key),
			})),
			art: await artOf(keys),
		};
	},
	discover: ({ kind }) => discover(kind),
	trailer: ({ type, id }) => trailer(type, id),
	search: ({ q }) => search(q),
	meta: ({ type = '', id = '' }) => id.startsWith('tmdb:') ? tmdbMeta(type, id) : cmMeta(type, id),
	season: async ({ id = '', n }) => (await tmdb<TmdbSeason>(`/tv/${id.slice(5)}/season/${n}`))
		.episodes.map(x => ({
			e: x.episode_number,
			title: x.name,
			overview: x.overview,
			still: x.still_path ? IMG + 'w300' + x.still_path : undefined,
			runtime: x.runtime,
		})),
};
