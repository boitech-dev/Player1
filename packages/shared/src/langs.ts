// Language logic. A profile watches through a preset: an ordered list of the languages it speaks,
// each one possibly "captioned" (read, not listened to: subtitles in it are welcome, a dub in it is
// not). From a preset come the tiers, tried in order:
//   dub:xx   audio in xx (a dub, or the original when it is in xx), no subtitles. Only for languages
//            not captioned.
//   sub:xx   original audio, subtitles in xx embedded in the release; ext:xx the same with
//            OpenSubtitles' subtitles
//   then always sub:en / ext:en (VOSTEN) and sub:orig (VOST: original audio, subtitles in the
//   original language)
//   vo       last resort: the original audio without subtitles (never a dub picked by accident)

export interface Lang {
	/** the tag of a dub in it (VF) and of subtitles in it (VOSTFR) */
	v: string;
	st: string;
	/** the names a track can carry: ISO 639-2 codes, then the 639-1 code */
	iso: string[];
	/** its English name, as track labels say it */
	name: string;
	/** Torrentio's word for it, to favour releases in it */
	torrentio?: string;
	/** release-name hints: a dub in it, subtitles in it */
	dub: RegExp;
	sub: RegExp;
}

export const LANGS: Record<string, Lang> = {
	fr: {
		v: 'VF',
		st: 'VOSTFR',
		iso: ['fre', 'fra', 'fr'],
		name: 'French',
		torrentio: 'french',
		dub: /\b(MULTI|VFF|VFQ|VFI|VF2?|VOF|TRUEFRENCH|FRENCH)\b|🇫🇷/i,
		sub: /VOSTFR|SUBFRENCH|SUBFR\b/i,
	},
	en: {
		v: 'VE',
		st: 'VOSTEN',
		iso: ['eng', 'en'],
		name: 'English',
		dub: /🇬🇧|🇺🇸/,
		sub: /VOSTEN|SUBENG\b|\bENG ?SUBS?\b/i,
	},
	es: {
		v: 'VS',
		st: 'VOSTSP',
		iso: ['spa', 'es'],
		name: 'Spanish',
		torrentio: 'spanish',
		dub: /\b(SPANISH|CASTELLANO|LATINO|ESP)\b|🇪🇸|🇲🇽/i,
		sub: /VOSTSP|SUBESP\b|SUBSPA\b/i,
	},
	de: {
		v: 'VD',
		st: 'VOSTDE',
		iso: ['ger', 'deu', 'de'],
		name: 'German',
		torrentio: 'german',
		dub: /\b(GERMAN|DL)\b|🇩🇪/i,
		sub: /SUBGER\b|GERSUB/i,
	},
	it: {
		v: 'VI',
		st: 'VOSTIT',
		iso: ['ita', 'it'],
		name: 'Italian',
		torrentio: 'italian',
		dub: /\b(ITA|ITALIAN)\b|🇮🇹/i,
		sub: /SUBITA\b/i,
	},
	pt: {
		v: 'VP',
		st: 'VOSTPT',
		iso: ['por', 'pt'],
		name: 'Portuguese',
		torrentio: 'portuguese',
		dub: /\b(PORTUGUESE|DUAL|DUBLADO)\b|🇧🇷|🇵🇹/i,
		sub: /LEGENDADO/i,
	},
	nl: {
		v: 'VN',
		st: 'VOSTNL',
		iso: ['dut', 'nld', 'nl'],
		name: 'Dutch',
		torrentio: 'dutch',
		dub: /\bDUTCH\b|🇳🇱/i,
		sub: /NLSUBS?\b/i,
	},
	ja: {
		v: 'VJ',
		st: 'VOSTJP',
		iso: ['jpn', 'ja'],
		name: 'Japanese',
		torrentio: 'japanese',
		dub: /🇯🇵/,
		sub: /JPSUBS?\b/i,
	},
	ko: {
		v: 'VK',
		st: 'VOSTKR',
		iso: ['kor', 'ko'],
		name: 'Korean',
		torrentio: 'korean',
		dub: /🇰🇷/,
		sub: /KORSUBS?\b/i,
	},
	zh: {
		v: 'VC',
		st: 'VOSTCN',
		iso: ['chi', 'zho', 'zh'],
		name: 'Chinese',
		torrentio: 'chinese',
		dub: /🇨🇳|🇹🇼/,
		sub: /CHSUBS?\b/i,
	},
	ru: {
		v: 'VR',
		st: 'VOSTRU',
		iso: ['rus', 'ru'],
		name: 'Russian',
		torrentio: 'russian',
		dub: /\bRUS\b|🇷🇺/i,
		sub: /RUSSUBS?\b/i,
	},
	ar: {
		v: 'VA',
		st: 'VOSTAR',
		iso: ['ara', 'ar'],
		name: 'Arabic',
		torrentio: 'arabic',
		dub: /🇸🇦|🇪🇬/,
		sub: /ARSUBS?\b/i,
	},
};

/** one language of a preset */
export interface PresetLang {
	code: string;
	captioned?: boolean;
}

/** a tier: dub:xx, sub:xx, ext:xx, sub:orig or vo (see the top of this file) */
export type Tier = string;

// original languages that aren't listed above still need their ISO 639-2 code to find the
// original track
const ISO3: Record<string, string> = {
	hi: 'hin',
	th: 'tha',
	tr: 'tur',
	pl: 'pol',
	sv: 'swe',
	da: 'dan',
	no: 'nor',
	fi: 'fin',
	he: 'heb',
	id: 'ind',
	vi: 'vie',
	uk: 'ukr',
	cs: 'cze',
	hu: 'hun',
	el: 'gre',
	ta: 'tam',
	te: 'tel',
};
const codesOf = (c: string) => {
	const iso3 = ISO3[c];
	return LANGS[c]?.iso ?? (iso3 ? [iso3, c] : [c]);
};

/** a track of a file: audio or subtitles */
export interface Track {
	id: string;
	iso?: string;
	label?: string;
}

const isLang = (c: string | null | undefined) => (t: Track) => {
	if (!c) return false;
	const known = LANGS[c];
	return codesOf(c).includes((t.iso ?? '').toLowerCase())
		|| (!!known && new RegExp(`^${known.name}`, 'i').test(t.label ?? ''));
};
const notForced = (t: Track) => !/forced|forcé/i.test(t.label ?? '');

/** a preset's tiers, in order; English subtitles and the original's own always end the list */
export function tiersOf(langs: PresetLang[] = []): Tier[] {
	const ok = langs.filter(l => LANGS[l.code]);
	return [...new Set([
		...ok.filter(l => !l.captioned).map(l => `dub:${l.code}`),
		...ok.flatMap(l => [`sub:${l.code}`, `ext:${l.code}`]),
		'sub:en',
		'ext:en',
		'sub:orig',
		'vo',
	])];
}

/** the tiers a person picks from: no OpenSubtitles twins, no last resort */
export const choosableTiers = (langs: PresetLang[]) => tiersOf(langs)
	.filter(t => !t.startsWith('ext:') && t !== 'vo');

/** a tier chosen for one title: it alone (an embedded-subtitle tier also accepts OpenSubtitles) */
export const tierAlone = (t: Tier): Tier[] => /^sub:(?!orig)/.test(t)
	? [t, t.replace('sub:', 'ext:')]
	: [t];

/** VF, VOSTFR, VOST, VO… */
export const tierTag = (t: Tier) => {
	const [kind, code = ''] = t.split(':');
	if (t === 'vo') return 'VO';
	if (code === 'orig') return 'VOST';
	return LANGS[code]?.[kind === 'dub' ? 'v' : 'st'] ?? t.toUpperCase();
};

/** what a release advertises in its name: audio languages (a) and subtitle languages (s) */
export interface StreamTag {
	a: string[];
	s: string[];
}

/** from a release name; RD's track list has the final word */
export function tagStream(t = ''): StreamTag {
	const codes = Object.keys(LANGS);
	const s = codes.filter(c => LANGS[c]!.sub.test(t));
	return {
		a: codes.filter(c => !s.includes(c) && LANGS[c]!.dub.test(t)),
		s,
	};
}

export const resOf = (n: string) => {
	if (/4k|2160p/i.test(n)) return 2160;
	if (/1440p/.test(n)) return 1440;
	if (/1080p/.test(n)) return 1080;
	if (/720p/.test(n)) return 720;
	if (/480p/.test(n)) return 480;
	return 360;
};
export const seedsOf = (t?: string) => +(/👤 (\d+)/.exec(t ?? '')?.[1] ?? 0);

/** what candidates() needs of a release */
export interface Rankable {
	tag: StreamTag;
	res: number;
	seeds: number;
}

type Rank = (s: Rankable) => number | null;

function rankFor(kind: string, c: string | undefined, orig: string | null | undefined): Rank {
	// a dub is advertised; the original language mostly isn't
	if (kind === 'dub') return s => {
		if (c && s.tag.a.includes(c)) return 0;
		return c === orig && !s.tag.s.length ? 1 : null;
	};
	// multi-language releases often embed several subtitles
	if (kind === 'sub') return s => {
		if (c && s.tag.s.includes(c)) return 0;
		return s.tag.a.length ? 1 : 2;
	};
	if (kind === 'vo') return s => s.tag.a.length ? 1 : 0;
	// external subtitles: plain originals first
	return s => {
		if (s.tag.s.length) return 2;
		return s.tag.a.length ? 1 : 0;
	};
}

/**
 * The releases worth trying for a tier, likeliest first; within a group, highest resolution (or
 * closest to the device's preferred one), then most seeders. orig: the title's original language.
 */
export function candidates<T extends Rankable>(
	streams: T[],
	tier: Tier,
	pref: number,
	orig: string | null | undefined,
): T[] {
	const [kind = '', code] = tier.split(':');
	const rank = rankFor(kind, code === 'orig' ? orig ?? undefined : code, orig);
	const by = (a: T, b: T) => (pref
		? Math.abs(a.res - pref) - Math.abs(b.res - pref)
		: b.res - a.res) || b.seeds - a.seeds;
	return streams
		.map(s => [rank(s), s] as const)
		.filter((x): x is readonly [number, T] => x[0] != null)
		.sort((a, b) => a[0] - b[0] || by(a[1], b[1]))
		.map(([, s]) => s);
}

/** the tracks of a file chosen for a tier */
export interface TrackPick {
	audio: string;
	sub: string;
}

/** the tracks of a file that satisfy a tier, or null. orig: the title's original language */
export function pickTracks(
	tier: Tier,
	audio: Track[],
	subs: Track[],
	orig: string | null | undefined,
): TrackPick | null {
	const [kind, code] = tier.split(':');
	if (kind === 'dub') {
		const a = audio.find(isLang(code));
		return a ? {
			audio: a.id,
			sub: 'none',
		} : null;
	}
	// unknown original: the first track
	const vo = audio.find(isLang(orig)) ?? (audio.length === 1 || !orig ? audio[0] : undefined);
	if (kind === 'vo') return vo ? {
		audio: vo.id,
		sub: 'none',
	} : null;
	const sub = subs
		.filter(isLang(code === 'orig' ? orig : code))
		.sort((a, b) => Number(notForced(b)) - Number(notForced(a)))[0];
	return vo && sub ? {
		audio: vo.id,
		sub: sub.id,
	} : null;
}
