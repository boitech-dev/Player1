import { t } from '@lingui/core/macro';
import { useSyncExternalStore } from 'react';

import type {
	Preset,
	State,
} from '@player1/shared/api';
import {
	choosableTiers,
	type StreamTag,
	tierTag,
} from '@player1/shared/langs';

// What the server knows of this household and profile (GET /api/state), shared by every screen.
// Screens read it with useApp(); changes go through setApp() so everything that shows it follows.

let state: State | null = null;
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => {
	listeners.add(l);
	return () => listeners.delete(l);
};

/** the household, once loaded (start() loads it before any screen shows) */
export const app = () => state!;

export function setApp(patch: Partial<State>) {
	state = {
		...state!,
		...patch,
	};
	listeners.forEach(l => l());
}

export const useApp = () => useSyncExternalStore(subscribe, app);

export const myProfile = (s = app()) => s.profiles.find(p => p.id === s.profile);

export const currentPreset = (s = app()): Preset | undefined =>
	s.presets.find(x => x.id === s.preset) ?? s.presets[0];

/** "VF, VOSTFR, VOSTEN, VOST": a preset's order of choice */
export const presetSays = (p?: Preset) => p ? choosableTiers(p.langs).map(tierTag).join(', ') : '';

/** a release's badge from its name: the subtitles it advertises, else a dub in one of the
 *  preset's languages, else VO */
export function badge(tag?: StreamTag): ['sub' | 'dub' | 'vo', string] {
	const mine = currentPreset()?.langs.map(l => l.code) ?? [];
	const s = tag?.s.find(c => mine.includes(c)) ?? tag?.s[0];
	if (s) return ['sub', tierTag('sub:' + s)];
	const a = tag?.a.find(c => mine.includes(c));
	return a ? ['dub', tierTag('dub:' + a)] : ['vo', 'VO'];
}

/** what this server calls its indexer and torrent client (C411, Whatbox…) */
export const names = () => app().names;

/** the lists' names as shown: the two built-in ones are translated */
export const listTitle = (name: string) => {
	if (name === 'Favoris') return t`My favorites`;
	if (name === 'À voir') return t`Watchlist`;
	return name;
};
