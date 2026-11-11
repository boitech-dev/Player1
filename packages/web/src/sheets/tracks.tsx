import { t } from '@lingui/core/macro';
import {
	useEffect,
	useRef,
	useSyncExternalStore,
} from 'react';

import { dec } from '../lib/i18n.ts';
import {
	chooseTrack,
	getView,
	nudge,
	subscribe,
} from '../player/engine.ts';
import { Button } from '../ui/Button.tsx';
import {
	closeSheet,
	openSheet,
	Opt,
	Sheet,
} from '../ui/sheet.tsx';
import { Stack } from '../ui/Stack.tsx';
import s from './tracks.module.scss';

// Audio and subtitles of the playing file. External subtitles (OpenSubtitles) can be shifted; the
// subtitle sheet sits at the top without dimming so they stay visible while they move.

const sign = (d: number) => d > 0 ? '+' : d < 0 ? '−' : '';
const fmtDelay = (d: number) => sign(d) + dec(Math.abs(d).toFixed(1)) + ' s';

function Delay() {
	const view = useSyncExternalStore(subscribe, getView);
	const fine = useRef<HTMLButtonElement>(null);
	useEffect(() => fine.current?.focus(), []); // the remote lands on the fine step
	const step = (d: number, n: string, ref?: typeof fine) => (
		<Button ref={ref} aria-label={t`Shift by ${n}`} onClick={() => nudge(d)}>
			{n}
		</Button>
	);
	return (
		<div className={s.delay}>
			{step(-1, '−1 s')}
			{step(-0.1, '−' + dec('0.1'))}
			{/* as wide as a long shift, so the buttons stay put */}
			<strong><Stack show={0}>{[fmtDelay(view.delay), fmtDelay(-88.8)]}</Stack></strong>
			{step(0.1, '+' + dec('0.1'), fine)}
			{step(1, '+1 s')}
		</div>
	);
}

function Tracks({ kind }: { kind: 'audio' | 'sub' }) {
	const view = useSyncExternalStore(subscribe, getView);
	const live = view.live;
	if (!live) return null;
	const list = kind === 'audio' ? live.audio : [{
		id: 'none',
		name: t`No subtitles`,
	}, ...live.subs];
	// only external subtitles can be shifted; embedded ones are drawn by the player
	const ext = kind === 'sub' && view.sel.sub.startsWith('ext-');
	return (
		<Sheet title={kind === 'audio' ? t`Audio` : t`Subtitles`}>
			{ext && <Delay />}
			{list.map(x => (
				<Opt
					key={x.id}
					title={x.name}
					on={view.sel[kind] === x.id}
					onClick={() => {
						closeSheet();
						chooseTrack(kind, x.id);
					}}
				/>
			))}
		</Sheet>
	);
}

export const trackSheet = (kind: 'audio' | 'sub') =>
	openSheet(<Tracks kind={kind} />, { peek: kind === 'sub' });
