import {
	type DependencyList,
	type RefObject,
	useEffect,
	useState,
} from 'react';

import { touch } from '../lib/device.ts';
import { toast } from './toast.tsx';

/** data a page fetches; a page left before the answer comes never sees it */
export function useLoad<T>(fn: () => Promise<T>, deps: DependencyList) {
	const [data, setData] = useState<T | null>(null);
	useEffect(() => {
		let live = true;
		setData(null);
		fn().then(d => live && setData(d), (err: Error) => live && toast(err.message, 6000));
		return () => {
			live = false;
		};
	// eslint-disable-next-line react-hooks/exhaustive-deps -- the caller lists what the fetch depends on
	}, deps);
	return data;
}

/** remote and keyboard users land on the page's first control marked data-land once it's there
 *  (not on phones) */
export function useLanding(scope: RefObject<HTMLElement | null>, ready: unknown) {
	useEffect(() => {
		if (!ready || touch) return;
		scope.current?.querySelector<HTMLElement>('[data-land]')?.focus({ preventScroll: true });
	}, [scope, ready]);
}
