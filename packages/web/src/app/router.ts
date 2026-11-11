import { useSyncExternalStore } from 'react';

import type {
	MediaType,
	PlayRequest,
} from '@player1/shared/api';

// Pages live in the address' hash: #/, #/cats, #/discover/anime, #/search/<q>, #/browse/<key>,
// #/item/<type>/<id>, #/play/<request as JSON>, #/settings

export type Route =
	| { page: 'home' }
	| { page: 'cats' }
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

const subscribe = (l: () => void) => {
	addEventListener('hashchange', l);
	return () => removeEventListener('hashchange', l);
};

/** the current page; a new hash renders the new page */
export function useRoute() {
	const hash = useSyncExternalStore(subscribe, () => location.hash);
	return {
		hash, route: parse(hash), 
	};
}

export const go = (hash: string) => {
	location.hash = hash;
};

export const itemHash = (type: MediaType, id: string) => `#/item/${type}/${encodeURIComponent(id)}`;
export const playHash = (p: PlayRequest) => '#/play/' + encodeURIComponent(JSON.stringify(p));
