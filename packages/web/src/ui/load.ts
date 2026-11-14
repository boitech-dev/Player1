import {
	type DependencyList,
	type RefObject,
	type SyntheticEvent,
	useEffect,
	useState,
	useSyncExternalStore,
} from 'react';

import { touch } from '../lib/device.ts';
import { toast } from './toast.tsx';

// how many page fetches are still on their way: the curtain stays down until the first page
// has what it shows
let pending = 0;
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => {
	listeners.add(l);
	return () => listeners.delete(l);
};
const count = (d: number) => {
	pending += d;
	listeners.forEach(l => l());
};
export const usePending = () => useSyncExternalStore(subscribe, () => pending);

/** once the page's fetches are in (a page asks as it mounts), or after max ms */
export const idle = (max: number) => new Promise<void>(ok => {
	const check = () => pending || done();
	const end = setTimeout(() => done(), max);
	function done() {
		clearTimeout(end);
		listeners.delete(check);
		ok();
	}
	listeners.add(check);
	setTimeout(check);
});

/** data a page fetches; a page left before the answer comes never sees it */
export function useLoad<T>(fn: () => Promise<T>, deps: DependencyList) {
	const [data, setData] = useState<T | null>(null);
	useEffect(() => {
		let live = true;
		let open = true;
		const done = () => {
			if (open) count(-1);
			open = false;
		};
		count(1);
		setData(null);
		fn().then(d => live && setData(d), (err: Error) => live && toast(err.message, 6000)).finally(done);
		return () => {
			live = false;
			done();
		};
	// eslint-disable-next-line react-hooks/exhaustive-deps -- the caller lists what the fetch depends on
	}, deps);
	return data;
}

/** waits for a picture to be in the browser's cache (3 s at most), so a backdrop shows with its page
 *  instead of after it */
export const preload = (url?: string) => new Promise<void>(ok => {
	if (!url) return ok();
	const img = new Image();
	img.onload = img.onerror = () => ok();
	img.src = url;
	setTimeout(ok, 3000);
});

// Cards (data-card) stay hidden until their pictures are in, then come up one after the other
// along their row, never out of order: a card waits for the one before it (global.scss draws it).
const STEP = 70; // ms between two cards
const next = new WeakMap<Element, number>(); // per row: when its next card may come up

/** a card picture's onLoad and onError: brings up the cards of its row that are ready, in order */
export function arrived(e: SyntheticEvent<HTMLImageElement>) {
	const row = e.currentTarget.closest('[data-card]')?.parentElement;
	if (!row) return;
	const now = performance.now();
	let at = Math.max(now, next.get(row) ?? 0);
	for (const card of row.querySelectorAll<HTMLElement>(':scope > [data-card]')) {
		if ('up' in card.dataset) continue;
		if (![...card.querySelectorAll('img')].every(i => i.complete)) break;
		card.style.animationDelay = `${Math.round(at - now)}ms`;
		card.dataset.up = '';
		at += STEP;
	}
	next.set(row, at);
}

/** remote and keyboard users land on the page's first control marked data-land once it's there
 *  (not on phones) */
export function useLanding(scope: RefObject<HTMLElement | null>, ready: unknown) {
	useEffect(() => {
		if (!ready || touch) return;
		scope.current?.querySelector<HTMLElement>('[data-land]')?.focus({ preventScroll: true });
	}, [scope, ready]);
}
