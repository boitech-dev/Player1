import { t } from '@lingui/core/macro';
import { useState } from 'react';

import type { Device } from '@player1/shared/api';
import {
	type Format,
	FORMATS,
} from '@player1/shared/release';

import { connect } from '../app/events.ts';
import { go } from '../app/router.ts';
import {
	get,
	post,
} from '../lib/api.ts';
import {
	directAuto,
	formatName,
	type FormatResult,
	getCaps,
	me,
	type Override,
	overrides,
	rename,
	setCaps,
	setOverrides,
} from '../lib/device.ts';
import { moment } from '../lib/format.ts';
import {
	runBench,
	useBench,
} from '../player/bench.ts';
import { Button } from '../ui/Button.tsx';
import { cx } from '../ui/cx.ts';
import { Field } from '../ui/Field.tsx';
import { Icon } from '../ui/Icon.tsx';
import {
	Choice,
	Seg,
} from '../ui/Seg.tsx';
import { Setting } from '../ui/Setting.tsx';
import {
	closeSheet,
	openSheet,
	Opt,
	Sheet,
} from '../ui/sheet.tsx';
import { Stack } from '../ui/Stack.tsx';
import tx from '../ui/text.module.scss';
import { toast } from '../ui/toast.tsx';
import s from './devices.module.scss';

// Devices: pair a new one, this device's name and what it plays, the server's settings, who's
// online

function Pairing() {
	const [code, setCode] = useState('');
	const submit = async () => {
		try {
			const { name } = await post('pair/approve', { code });
			closeSheet();
			toast(t`${name} is connected`);
		} catch (err) {
			toast((err as Error).message);
		}
	};
	return (
		<Field onSubmit={submit}>
			<input
				inputMode="numeric"
				autoComplete="off"
				maxLength={7}
				value={code}
				onChange={e => setCode(e.target.value)}
				placeholder={t`Code shown on the device`}
				aria-label={t`Code shown on the device`}
			/>
			<Button tone="lampe" type="submit">{t`Confirm`}</Button>
		</Field>
	);
}

function Rename() {
	const [name, setName] = useState(me.name);
	const submit = () => {
		const n = name.trim();
		if (!n) return;
		rename(n);
		connect();
		toast(t`Device renamed`);
	};
	return (
		<Field onSubmit={submit}>
			<input
				value={name}
				maxLength={40}
				onChange={e => setName(e.target.value)}
				aria-label={t`This device’s name`}
			/>
			<Button type="submit">{t`Rename`}</Button>
		</Field>
	);
}

const capsSummary = () => {
	const caps = getCaps();
	if (!caps) return t`Not tested yet`;
	const n = FORMATS.filter(k => caps.results[k]?.ok).length;
	const total = FORMATS.length;
	const net = caps.net || '?';
	return t`Plays ${n} of ${total} video formats smoothly. Connection: ${net} Mbit/s`;
};

function Devices({ others }: { others: Device[] }) {
	return (
		<Sheet title={t`Devices`}>
			<h5>{t`Add a device`}</h5>
			<Pairing />
			<h5>{t`This device`}</h5>
			<Opt title={t`Playback on this device`} sub={capsSummary()} onClick={playbackSheet} />
			<Rename />
			<h5>{t`This server`}</h5>
			<Opt
				title={t`Server settings`}
				sub={t`Real-Debrid, torrent site, qBittorrent, Jellyfin`}
				onClick={() => {
					closeSheet();
					go('#/settings');
				}}
			/>
			<h5>{t`Connected right now`}</h5>
			{others.map(d => <p key={d.id} className={tx.empty}>{d.name}</p>)}
			{!others.length && <p className={tx.empty}>{t`No other device is connected.`}</p>}
		</Sheet>
	);
}

export async function devicesSheet() {
	const others = (await get('devices')).filter(d => d.id !== me.id);
	openSheet(<Devices others={others} />);
}

// --- "Playback on this device": what the test measured, what is used, and the device's own
// overrides ---

/** what a viewer would notice, worst first */
function verdict(r: FormatResult): ['good' | 'bad', string] {
	if (r.lagged) return ['bad', t`Stuttered during a film: avoided`];
	if (r.why === 'Not supported') return ['bad', t`This device can’t play it`];
	if (r.why === 'Playback failed') return ['bad', t`The test clip didn’t play`];
	if (r.why) return ['bad', r.why];
	if (r.ok) return ['good', t`Smooth`];
	if (r.stalls) {
		const n = r.stalls;
		return ['bad', t`Froze ${n} times in 8 seconds`];
	}
	if ((r.speed ?? 0) < 1.2) return ['bad', t`Too slow: can’t keep up with the video`];
	const n = Math.max(1, Math.round((100 - (r.smooth ?? 0)) / 10));
	return ['bad', t`Choppy: skips ${n} frames out of 10`];
}

function Choose({
	k,
	auto,
	disabled,
	label,
	onChange,
}: {
	k: Format | 'direct';
	auto: boolean;
	disabled: boolean;
	label: string;
	onChange: () => void;
}) {
	const o = overrides();
	const set = (v: Override | 'auto') => {
		const next = { ...overrides() };
		if (v === 'auto') delete next[k];
		else next[k] = v;
		setOverrides(next);
		connect();
		onChange();
	};
	const opts: [Override | 'auto', string][] = [
		['auto', auto ? t`Auto (yes)` : t`Auto (no)`],
		['on', t`Yes`],
		['off', t`No`],
	];
	return (
		<Seg label={label}>
			{opts.map(([v, l]) => (
				<Choice key={v} pressed={(o[k] ?? 'auto') === v} disabled={disabled} onClick={() => set(v)}>
					{l}
				</Choice>
			))}
		</Seg>
	);
}

function Playback() {
	const run = useBench();
	const [, redraw] = useState(0);
	const changed = () => redraw(n => n + 1);
	const caps = getCaps();
	const res = run ? run.results : caps?.results ?? {};
	const rerun = () => {
		setCaps(null);
		changed();
		runBench().catch(() => toast(t`The test couldn’t run`)).finally(changed);
	};
	const step = Math.max(0, FORMATS.indexOf(run?.key ?? 'h264'));
	const n = step + 1;
	const total = FORMATS.length;
	const when = caps ? moment(caps.at) : '';
	const net = caps?.net ?? 0;
	return (
		<Sheet title={t`Playback on this device`} onBack={devicesSheet}>
			<div className={s.top}>
				<Stack show={run ? 0 : 1}>
					<div className={s.row}>
						<p><strong>{t`Test ${n} of ${total}:`}</strong> {formatName(run?.key ?? 'h264')}</p>
						<div className={s.bar}><i style={{ width: (step + 0.5) / total * 100 + '%' }} /></div>
					</div>
					<div className={s.row}>
						<Button tone="lampe" onClick={rerun}>
							<Icon name="bolt" />
							{caps ? t`Run the test again` : t`Test this device`}
						</Button>
						<p>
							{caps
								? t`Tested on ${when}, ${net} Mbit/s connection.`
								: t`The test plays a few seconds of each format to find which ones this device shows smoothly.`}
						</p>
					</div>
				</Stack>
			</div>
			{FORMATS.map(k => {
				const r = res[k];
				const testing = run?.key === k ? t`Testing…` : t`Waiting`;
				const [tone, text] = r ? verdict(r) : [undefined, run ? testing : t`Not tested yet`];
				return (
					<Setting key={k} title={formatName(k)} says={text} tone={cx(s.verdict, tone && s[tone])}>
						<Choose k={k} auto={!!r?.ok} disabled={!!run} label={formatName(k)} onChange={changed} />
					</Setting>
				);
			})}
			<Setting
				title={t`Original files`}
				says={t`This device plays the film as it is, without waiting for Real-Debrid to convert it`}
			>
				<Choose
					k="direct"
					auto={directAuto()}
					disabled={!!run}
					label={t`Original files`}
					onChange={changed}
				/>
			</Setting>
		</Sheet>
	);
}

export function playbackSheet() {
	openSheet(<Playback />);
}
