import { useSyncExternalStore } from 'react';

import s from './toast.module.scss';

// one message at a time, at the bottom of the screen

let message: string | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach(l => l());

export function toast(m: string, ms = 3500) {
	message = m;
	changed();
	clearTimeout(timer);
	timer = setTimeout(() => {
		message = null;
		changed();
	}, ms);
}

const subscribe = (l: () => void) => {
	listeners.add(l);
	return () => listeners.delete(l);
};

export function Toast() {
	const m = useSyncExternalStore(subscribe, () => message);
	return <div className={s.toast} hidden={!m} role="status">{m}</div>;
}
