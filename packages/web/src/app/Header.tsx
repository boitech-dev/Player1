import { t } from '@lingui/core/macro';
import {
	useEffect,
	useRef,
	useState,
} from 'react';

import {
	keep,
	load,
} from '../lib/store.ts';
import { ProfileButton } from '../screens/Who.tsx';
import { devicesSheet } from '../sheets/devices.tsx';
import { presetSheet } from '../sheets/presets.tsx';
import type { PickProfile } from '../sheets/profiles.tsx';
import { Button } from '../ui/Button.tsx';
import { Icon } from '../ui/Icon.tsx';
import s from './Header.module.scss';
import type { Route } from './router.ts';
import {
	currentPreset,
	useApp,
} from './state.ts';

const searches = (): string[] => {
	try {
		return JSON.parse(load('searches') ?? '[]') as string[];
	} catch {
		return [];
	}
};

/** the header's real height, for the pages under it (--head) */
const measure = (el: HTMLElement | null) =>
	document.documentElement.style.setProperty('--head', (el?.offsetHeight ?? 0) + 'px');

export function Header({
	route,
	onPick,
}: { route: Route; onPick: PickProfile }) {
	const app = useApp();
	const ref = useRef<HTMLElement>(null);
	const q = useRef<HTMLInputElement>(null);
	useEffect(() => {
		const el = ref.current;
		measure(el);
		const ro = new ResizeObserver(() => measure(el));
		if (el) ro.observe(el);
		return () => {
			ro.disconnect();
			measure(null);
		};
	}, []);
	useEffect(() => {
		if (route.page === 'search' && q.current) q.current.value = route.q;
	}, [route]);
	const [past, setPast] = useState(searches);
	// the last 10 searches, on this device, latest first
	const search = (el: HTMLInputElement) => {
		const v = el.value.trim();
		if (!v) return;
		const list = [v, ...past.filter(x => x !== v)].slice(0, 10);
		setPast(list);
		keep('searches', JSON.stringify(list));
		location.hash = '#/search/' + encodeURIComponent(v);
		el.blur();
	};
	const here = (p: Route['page']) => route.page === p ? 'page' as const : undefined;
	return (
		<header id="head" className={s.header} ref={ref}>
			<a className={s.brand} href="#/">Player1</a>
			<nav className={s.nav}>
				<a href="#/cats" aria-current={here('cats')}>
					<Icon name="cats" filled />
					<span>{t`Categories`}</span>
				</a>
				<a href="#/discover" aria-current={here('discover')}>
					<Icon name="discover" filled />
					<span>{t`Discover`}</span>
				</a>
			</nav>
			<label className={s.search}>
				<Icon name="search" />
				<input
					ref={q}
					id="q"
					type="search"
					placeholder={t`Movie, series, anime`}
					enterKeyHint="search"
					aria-label={t`Search`}
					list="past"
					onKeyDown={e => {
						if (e.key === 'Enter') search(e.currentTarget);
					}}
					// a past search picked from the list goes at once
					onInput={e => {
						const kind = (e.nativeEvent as InputEvent).inputType;
						if (!kind || kind === 'insertReplacementText') search(e.currentTarget);
					}}
				/>
				<datalist id="past">
					{past.map(x => <option key={x} value={x} />)}
				</datalist>
			</label>
			<nav className={s.nav}>
				<a href="#/rewatch" aria-current={here('rewatch')}>
					<Icon name="rewatch" filled />
					<span>{t`Rewatch`}</span>
				</a>
			</nav>
			<span className={s.spacer} />
			<Button className={s.mode} aria-label={t`Language`} onClick={presetSheet}>
				{currentPreset(app)?.name ?? t`Language`}
			</Button>
			<ProfileButton onPick={onPick} />
			<Button className={s.devices} onClick={devicesSheet}>
				<Icon name="screen" />
				<span>{t`Devices`}</span>
			</Button>
		</header>
	);
}
