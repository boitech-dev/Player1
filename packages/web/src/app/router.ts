import { useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';

import type {
	MediaType,
	PlayRequest,
} from '@player1/shared/api';

import { idle } from '../ui/load.ts';

// Pages live in the address' hash: #/, #/cats, #/discover/anime, #/search/<q>, #/browse/<key>,
// #/item/<type>/<id>, #/play/<request as JSON>, #/settings, #/rewatch

export type Route =
	| { page: 'home' }
	| { page: 'cats' }
	| { page: 'rewatch' }
	| { page: 'discover'; kind?: string }
	| { page: 'search'; q: string }
	| { page: 'browse'; key: string }
	| { page: 'item'; type: MediaType; id: string }
	| { page: 'play'; req: PlayRequest }
	| { page: 'settings' };

function parse(hash: string): Route {
	const [, r, a = '', b = ''] = hash.split('/');
	const dec = (x: string) => {
		try {
			return decodeURIComponent(x);
		} catch {
			return x;
		}
	};
	switch (r) {
		case 'cats': return { page: 'cats' };
		case 'rewatch': return { page: 'rewatch' };
		case 'settings': return { page: 'settings' };
		case 'discover': return {
			page: 'discover',
			kind: a || undefined,
		};
		case 'search': return {
			page: 'search',
			q: dec(a),
		};
		case 'browse': return {
			page: 'browse',
			key: a,
		};
		case 'item': return {
			page: 'item',
			type: a === 'series' ? 'series' : 'movie',
			id: dec(b),
		};
		case 'play': try {
			return {
				page: 'play',
				req: JSON.parse(dec(a)) as PlayRequest,
			};
		} catch {
			return { page: 'home' };
		}
		default: return { page: 'home' };
	}
}

// one page fades into the next (the browser's view transition, where it has one): the old one stays
// up while the new one fetches what it shows, up to a moment, so it comes whole. Not around the
// player, which has its own way in and out
const listeners = new Set<() => void>();
let shown = location.hash; // the address the pages show: the old one until the fade has its picture
addEventListener('hashchange', () => {
	const next = location.hash;
	const tell = () => {
		shown = next;
		listeners.forEach(l => l());
	};
	if (!document.startViewTransition || [shown, next].some(h => h.startsWith('#/play'))) return tell();
	document.startViewTransition(() => {
		flushSync(tell);
		return idle(800);
	});
});
const subscribe = (l: () => void) => {
	listeners.add(l);
	return () => listeners.delete(l);
};

/** the current page; a new hash renders the new page */
export function useRoute() {
	const hash = useSyncExternalStore(subscribe, () => shown);
	return {
		hash, route: parse(hash), 
	};
}

export const go = (hash: string) => {
	location.hash = hash;
};

export const itemHash = (type: MediaType, id: string) => `#/item/${type}/${encodeURIComponent(id)}`;
export const playHash = (p: PlayRequest) => '#/play/' + encodeURIComponent(JSON.stringify(p));
