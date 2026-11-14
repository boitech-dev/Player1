// The household: its profiles, each one's language presets, lists, watch progress and discover
// verdicts.
import { msg } from '@lingui/core/macro';

import {
	FAVORITES,
	isUiLang,
	type Item,
	type ListEntry,
	MAX_AGES,
	type PostRoutes,
	type Preset,
	type Progress,
	type State,
	WATCHLIST,
} from '@player1/shared/api';
import { LANGS as SPOKEN } from '@player1/shared/langs';

import { visible } from './catalog.ts';
import {
	activePreset,
	db,
	me,
	newProfile,
	pinHash,
	presetFor,
	type Profile,
	save,
	settingsHash,
	summaries,
	uid,
} from './db.ts';
import { broadcast } from './devices.ts';
import type {
	GetHandlers,
	PostHandlers,
} from './http.ts';
import {
	lang,
	t,
	UserError,
} from './i18n.ts';
import { follow } from './play.ts';
import { SEEDBOX } from './qbit.ts';
import {
	INDEXER,
	MEDIA,
} from './sources.ts';
import {
	hasTmdb,
	warn,
} from './upstream.ts';

// a brand-new install's first profile takes the language of the first device that opens it
function firstRun() {
	const p = me();
	if (!p.fresh) return;
	delete p.fresh;
	if (!Object.keys(p.progress ?? {}).length) {
		const l = lang(), x = presetFor(l);
		Object.assign(p, {
			name: t(msg`Profile 1`),
			lang: l,
			presets: [x],
			preset: x.id,
		});
	}
	save();
}

async function state(): Promise<State> {
	firstRun();
	const p = me();
	return {
		...await visible(p),
		profile: p.id,
		welcome: p.welcome,
		profiles: summaries(),
		presets: p.presets,
		preset: activePreset().id,
		tmdb: hasTmdb,
		names: {
			indexer: INDEXER,
			seedbox: SEEDBOX,
		},
		library: !!MEDIA,
		titleModes: p.titleModes || {},
	};
}

const entry = (item: ListEntry): ListEntry => ({
	id: item.id,
	type: item.type,
	title: item.title,
	sub: item.sub,
	year: item.year,
	poster: item.poster,
});

// toggle item in list; empty lists vanish (except Favoris)
function toggle(name: string, item: ListEntry, on: boolean) {
	const lists = me().lists, l = (lists[name] ||= []).filter(x => x.id !== item.id);
	if (on) l.unshift(entry(item));
	if (l.length || name === FAVORITES) lists[name] = l;
	else delete lists[name];
	save();
	return lists;
}

// discover verdicts: hide = never again, later = not before tomorrow, keep = into "À voir",
// seen = already watched
const VERDICTS: Record<string, number> = {
	hide: 0,
	keep: 1,
	seen: 2,
};
async function swipe(item: Item, verdict: string) {
	const p = me(), k = item.type + item.id;
	if (verdict === 'later') (p.snooze ||= {})[k] = Date.now() + 20 * 3600e3;
	else (p.seen ||= {})[k] = VERDICTS[verdict] ?? 0;
	if (verdict === 'seen') (p.marked ||= {})[k] = {
		...entry(item),
		at: Date.now(),
	};
	else delete p.marked?.[k];
	if (verdict === 'keep') toggle(WATCHLIST, item, true);
	else save();
	const { lists, marked } = await visible(p);
	return {
		lists,
		marked,
	};
}

// profiles: add ({ name, color, avatar }), edit ({ id, name, color, avatar }), delete ({ id, remove });
// the last one stays. An avatar is a picture's name ('' goes back to the initial). A profile held to
// a max age changes only itself, its limit included: its settings PIN is what keeps it. A profile
// whose settings ask a PIN is changed with its settings token (auth), one with a PIN to open it
// with that token, unless it's the one acting (opened with it)
function edit(p: Profile, b: PostRoutes['profiles']['body'], name: string, l?: string) {
	if (name) p.name = name;
	if (b.color != null) p.color = +b.color || 0;
	if (typeof b.avatar === 'string') {
		p.avatar = /^[a-z]+-\d{1,2}$/.test(b.avatar) ? b.avatar : undefined;
	}
	if (l) p.lang = l;
	protect(p, b);
	limit(p, b);
}
const hashOf = (p: Profile, pin: string) => {
	if ([...pin].length !== 4) throw new UserError(msg`A PIN is 4 characters`);
	return pinHash(p.id, pin);
};
// its PINs: the one that opens it, and what its settings ask
function protect(p: Profile, b: PostRoutes['profiles']['body']) {
	if (b.pin === '') {
		// its settings keep the PIN they shared with it
		if (p.guard === 'same') Object.assign(p, {
			guard: 'own',
			guardPin: p.pin,
		});
		delete p.pin;
		delete p.lock;
	} else if (typeof b.pin === 'string') p.pin = hashOf(p, b.pin);
	if (b.lock === 'switch' || b.lock === 'open') p.lock = b.lock;
	if (typeof b.guardPin === 'string') p.guardPin = hashOf(p, b.guardPin);
	if (b.guard === '') {
		delete p.guard;
		delete p.guardPin;
	} else if (b.guard === 'same') {
		if (!p.pin) throw new UserError(msg`Set this profile’s PIN code first`);
		p.guard = 'same';
		delete p.guardPin;
	} else if (b.guard === 'own') {
		if (!p.guardPin) throw new UserError(msg`Type a PIN for its settings`);
		p.guard = 'own';
	}
}
// its age limit: only from itself (else any profile, a new unprotected one too, could change it),
// never on the last profile without one; its settings PIN is what keeps it
function limit(p: Profile, b: PostRoutes['profiles']['body']) {
	if (b.maxAge === undefined && b.unrated === undefined) return;
	if (p !== me()) throw new UserError(msg`Only the profile itself can change its age limit`);
	if (b.maxAge !== undefined) {
		const max = MAX_AGES.find(x => x === b.maxAge);
		if (max === undefined) delete p.maxAge;
		else if (db.profiles.every(x => x === p || x.maxAge != null)) {
			throw new UserError(msg`Keep at least one profile without an age limit`);
		} else p.maxAge = max;
	}
	if (typeof b.unrated === 'boolean') p.unrated = b.unrated;
}
function mayChange(p: Profile, b: PostRoutes['profiles']['body']) {
	const self = me();
	if (self.maxAge != null && (p !== self || b.remove)) {
		throw new UserError(msg`A profile with an age limit can’t change the other profiles`);
	}
	const settings = settingsHash(p);
	const needed = settings ?? (p !== self ? p.pin : undefined); // its own token came with the request
	if (needed && b.auth !== needed) throw new UserError(msg`This profile’s PIN is needed to change it`);
}
function profiles(b: PostRoutes['profiles']['body']) {
	const n = String(b.name || '').trim().slice(0, 24), p = db.profiles.find(x => x.id === b.id);
	const l = isUiLang(b.lang) ? b.lang : undefined;
	if (p) mayChange(p, b);
	else if (me().maxAge != null && settingsHash(me()) && b.auth !== settingsHash(me())) {
		// held to an age limit: a new profile would be a way out, its settings PIN first
		throw new UserError(msg`This profile’s settings PIN is needed to add a profile`);
	}
	if (b.remove) {
		if (p && db.profiles.length > 1) {
			db.profiles = db.profiles.filter(x => x !== p);
			broadcast({ gone: true }, p.id);
		}
	} else if (p) edit(p, b, n, l);
	else if (n) {
		if (db.profiles.length >= 12) throw new UserError(msg`12 profiles at most`);
		// its name, color, avatar and language were just given: its languages remain
		const fresh = newProfile(n, 0, l || lang());
		edit(fresh, b, n);
		db.profiles.push({
			...fresh,
			welcome: 'languages',
		});
	}
	save();
	return summaries();
}

// a PIN's token; five wrong tries in a row wait a minute
const tries = new Map<string, { n: number; at: number }>();
function unlock({ id, pin, settings }: PostRoutes['unlock']['body']) {
	const p = db.profiles.find(x => x.id === id);
	const want = p && (settings ? settingsHash(p) : p.pin);
	if (!p || !want) throw new UserError(msg`This profile has no PIN`);
	const t = tries.get(p.id) ?? {
		n: 0,
		at: 0,
	};
	if (t.n >= 5 && Date.now() - t.at < 60e3) throw new UserError(msg`Too many wrong PINs. Try again in a minute.`);
	if (pinHash(p.id, String(pin)) !== want) {
		tries.set(p.id, {
			n: t.n + 1,
			at: Date.now(),
		});
		throw new UserError(msg`Wrong PIN`);
	}
	tries.delete(p.id);
	return { token: want };
}

// watch progress per film / episode (key = imdb or imdb:s:e); watched once past 90% or marked by
// hand
function progress({ key, pos, dur, watched, info }: PostRoutes['progress']['body']) {
	const p = me().progress ||= {}, old: Partial<Progress> = p[key] || {};
	// title-level details an entry arrived without (a request built from an older, incomplete
	// entry): take them from its siblings
	const sib = info?.id && Object.values(p).find(x => x.id === info.id && x.poster);
	const title = {
		poster: sib ? sib.poster : undefined,
		lang: sib ? sib.lang : undefined,
	};
	const entry: Progress = {
		...title,
		...old,
		...info,
		pos: pos ?? old.pos ?? 0,
		dur: dur ?? old.dur ?? 0,
		watched: watched ?? old.watched ?? false,
		at: Date.now(),
	};
	p[key] = entry;
	save();
	// finished, and it came without the episode after it: looked up behind the answer; then the
	// profile's other devices hear of it (their Resume goes on from here)
	const who = me().id;
	void follow(p, key).catch(warn('resume'))
		.then(() => broadcast({ progress: { [key]: p[key]! } }, who));
	return entry;
}

// language presets: pick one ({ id }), or replace the whole list ({ presets: [{ id?, name, langs:
// [{ code, captioned }] }] })
function presets(given: PostRoutes['presets']['body']['presets'] = []) {
	const list = given.slice(0, 12).map((x): Preset => ({
		id: /^[0-9a-f]{8}$/.test(x.id ?? '') ? x.id ?? '' : uid(),
		name: String(x.name || '').trim().slice(0, 30),
		langs: (x.langs || []).filter(l => SPOKEN[l.code]).slice(0, 8)
			.map(l => l.captioned ? {
				code: l.code,
				captioned: true,
			} : { code: l.code }),
	})).filter(x => x.name && x.langs.length);
	if (!list.length) throw new UserError(msg`Keep at least one preset, with at least one language in it`);
	const p = me();
	p.presets = list;
	if (!list.some(x => x.id === p.preset)) p.preset = list[0]!.id;
	save();
	broadcast({ preset: p.preset }, p.id);
	return {
		presets: list,
		preset: p.preset,
	};
}

export const householdGets: GetHandlers = {
	state,
	who: summaries,
};

export const householdPosts: PostHandlers = {
	profiles,
	unlock,
	// a part of the first visit is done
	welcome: ({ done }) => {
		const p = me();
		if (done === 'profile' && p.welcome === 'all') p.welcome = 'languages';
		else if (done === 'languages') delete p.welcome;
		save();
		return { welcome: p.welcome };
	},
	// a title can be held to one tier of the presets (key = "series:tmdb:42509", tier =
	// "sub:fr"); null goes back to the preset
	titlemode: ({ key, tier }) => {
		const modes = me().titleModes ||= {};
		if (tier && /^(dub|sub):([a-z]{2}|orig)$/.test(tier)) modes[key] = tier;
		else delete modes[key];
		save();
		return modes;
	},
	// playback trouble, reported by the device
	log: ({ dev, msg: m }) => {
		console.log('player', String(dev).slice(0, 40) + ':', String(m).slice(0, 700));
		return {};
	},
	progress,
	preset: ({ id }) => {
		const p = me();
		if (!p.presets.some(x => x.id === id)) throw new UserError(msg`Unknown preset`);
		p.preset = id;
		save();
		broadcast({ preset: id }, p.id);
		return { preset: id };
	},
	presets: ({ presets: given }) => presets(given),
	lists: async ({ name, item, on }) => {
		toggle(name, item, on);
		return (await visible()).lists;
	},
	swipe: ({ item, verdict }) => swipe(item, verdict),
};
