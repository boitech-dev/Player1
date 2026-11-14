// Storage: one JSON file per household. Each profile (a person) keeps its own language presets,
// lists, progress and discover verdicts; downloads and devices are shared.
import { AsyncLocalStorage } from 'node:async_hooks';
import crypto from 'node:crypto';
import fs from 'node:fs';

import type {
	Download,
	ListEntry,
	Marked,
	Preset,
	ProfileSummary,
	Progress,
	Welcome,
} from '@player1/shared/api';
import type { Tier } from '@player1/shared/langs';

import { DATA } from './config.ts';

export interface Profile extends ProfileSummary {
	presets: Preset[];
	preset: string;
	lists: Record<string, ListEntry[]>;
	/** discover verdicts per type+id: 0 hide, 1 keep, 2 seen */
	seen?: Record<string, number>;
	/** the titles behind the "seen" verdicts, for Rewatch */
	marked?: Record<string, Marked>;
	/** per title: a tier forced for it */
	titleModes?: Record<string, Tier>;
	progress?: Record<string, Progress>;
	/** discover: not shown again before this time */
	snooze?: Record<string, number>;
	/** a brand-new install's first profile, not opened yet */
	fresh?: boolean;
	/** what this profile still has to go through on its first visit */
	welcome?: Welcome;
	/** older files: the French modes, before presets */
	mode?: string;
}

export interface Db {
	profiles: Profile[];
	downloads?: Download[];
}

const DATA_FILE = process.env.DATA_FILE || `${DATA}/db.json`;
type Stored = Partial<Db> & Record<string, unknown>;
let stored: Stored = {};
try {
	stored = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) as Stored;
} catch { /* a new household */ }

const OWN = ['mode', 'lists', 'seen', 'titleModes', 'progress', 'snooze'] as const;
export const uid = () => crypto.randomBytes(4).toString('hex');
// language presets (see langs.ts): a new profile starts with one, in the language its interface
// uses
const ownName = (c: string) => {
	const n = new Intl.DisplayNames([c], { type: 'language' }).of(c) ?? c;
	return n.charAt(0).toUpperCase() + n.slice(1);
};
export const presetFor = (code = 'fr'): Preset => ({
	id: uid(),
	name: ownName(code),
	langs: [{ code }],
});
export const newProfile = (name: string, color: number, lang?: string): Profile => {
	const p = presetFor(lang);
	return {
		id: uid(),
		name,
		color,
		lang,
		presets: [p],
		preset: p.id,
		lists: { Favoris: [] },
		seen: {},
		titleModes: {},
		progress: {},
		snooze: {},
	};
};

// older single-household file: everything becomes the first profile
function firstProfile(old: Stored): Profile {
	const first: Profile = {
		...newProfile('Profile 1', 0),
		fresh: true,
	};
	const own = OWN.filter(k => old[k]);
	// nothing to carry over: a new install, whose first person is welcomed
	if (!own.length) first.welcome = 'all';
	Object.assign(first, Object.fromEntries(own.map(k => [k, old[k]])));
	for (const k of own) delete old[k];
	return first;
}

// older profiles: the French modes become two presets, per-title modes become tiers
const OLD_MODES: Record<string, Tier> = {
	vf: 'dub:fr',
	vostfr: 'sub:fr',
	vosten: 'sub:en',
};
function toPresets(p: Profile) {
	const fr: Preset = {
		id: uid(),
		name: 'Français',
		langs: [{ code: 'fr' }, {
			code: 'en',
			captioned: true,
		}],
	};
	const en: Preset = {
		id: uid(),
		name: 'English',
		langs: [{
			code: 'en',
			captioned: true,
		}],
	};
	p.presets = [fr, en];
	p.preset = p.mode === 'vosten' ? en.id : fr.id;
	delete p.mode;
	const modes = p.titleModes ?? {};
	for (const [k, m] of Object.entries(modes)) {
		const t = OLD_MODES[m];
		if (t) modes[k] = t;
		else delete modes[k];
	}
}

stored.profiles ??= [firstProfile(stored)];
for (const p of stored.profiles) if (!p.presets) toPresets(p);
export const db = stored as Db;

export const save = () => {
	fs.mkdirSync(DATA, { recursive: true });
	fs.writeFileSync(DATA_FILE + '.tmp', JSON.stringify(db));
	fs.renameSync(DATA_FILE + '.tmp', DATA_FILE);
};

// the profile a request acts for: the x-profile header (or ?profile= for the event stream), else
// the first one; lang is the device's interface language (x-lang)
export const request = new AsyncLocalStorage<{ profile: Profile; lang?: string }>();
// a profile always exists: deleting the last one is refused
const firstOne = () => db.profiles[0]!;
export const me = () => request.getStore()?.profile ?? firstOne();
export const profileOf = (id?: string) => db.profiles.find(p => p.id === id) ?? firstOne();
export const activePreset = (p = me()) => p.presets.find(x => x.id === p.preset) ?? p.presets[0]!;
export const summaries = (): ProfileSummary[] => db.profiles.map(p => ({
	id: p.id,
	name: p.name,
	color: p.color,
	avatar: p.avatar,
	lang: p.lang,
}));
