import { t } from '@lingui/core/macro';
import { useEffect } from 'react';

import type { ProfileSummary } from '@player1/shared/api';

import {
	myProfile,
	useApp,
} from '../app/state.ts';
import {
	choose,
	type PickProfile,
	profileEdit,
	profilesSheet,
} from '../sheets/profiles.tsx';
import { Button } from '../ui/Button.tsx';
import s from './Who.module.scss';

// Profiles: each person keeps their own language, lists, progress and discoveries; a device
// remembers who uses it.

// a profile keeps its color by its place here: new ones go at the end; each light enough for the
// dark initial on it
export const COLORS = [
	'#f5c46b',
	'#e8798f',
	'#7fd1b9',
	'#7fb2f0',
	'#b48cf2',
	'#f2936b',
	'#b9cf7a',
	'#d9c3a5',
	'#ef6f6c',
	'#f4a6c8',
	'#f3e08a',
	'#8fcf8f',
	'#5cc6c9',
	'#9aa7f5',
	'#d6a6f0',
	'#a9b8c9',
	'#f7b58c',
	'#c49a6c',
	'#8fd8f5',
	'#e88fd8',
	'#c8e86b',
	'#ffb3a7',
	'#b0e0d0',
	'#e0b0ff',
];

/** the pictures a profile can wear (src/avatars, credited in its README): name (people-3) → url */
export const AVATARS = Object.fromEntries(
	Object.entries(import.meta.glob<string>('../avatars/*.svg', {
		eager: true,
		// files of their own, not inlined into the app's script: only the picker shows most of them
		query: '?no-inline',
		import: 'default',
	}))
		.map(([file, url]) => [file.slice('../avatars/'.length, -'.svg'.length), url])
		.sort(([a], [b]) => a!.localeCompare(b!, 'en', { numeric: true })),
);

/** a profile's picture on its color, else its initial */
export function Avatar({ p }: { p?: Pick<ProfileSummary, 'name' | 'color' | 'avatar'> }) {
	const pic = p?.avatar && AVATARS[p.avatar];
	return (
		<span className={s.ava} style={{ background: COLORS[(p?.color || 0) % COLORS.length] }}>
			{pic ? <img src={pic} alt="" /> : (p?.name || '?').trim()[0]?.toUpperCase() || '?'}
		</span>
	);
}

/** the header's profile button: the current profile's avatar, opens the profiles sheet */
export function ProfileButton({ onPick }: { onPick: PickProfile }) {
	const p = myProfile(useApp());
	const name = p?.name ?? '';
	return (
		<Button
			className={s.whoBtn}
			id="whoBtn"
			aria-label={t`Profile: ${name}`}
			onClick={() => profilesSheet(onPick)}
		>
			<Avatar p={p} />
		</Button>
	);
}

/** "Who's watching?": a device that doesn't know its profile yet, in a household of several */
export function WhoScreen({
	onPick,
	ask,
}: { onPick: PickProfile; ask?: string }) {
	const { profiles } = useApp();
	// this device's profile wants its PIN: asked at once
	useEffect(() => {
		const p = profiles.find(x => x.id === ask);
		if (p) void choose(p, onPick);
	}, [ask]); // eslint-disable-line react-hooks/exhaustive-deps
	return (
		<section className={s.who}>
			<h1>{t`Who’s watching?`}</h1>
			<div className={s.people}>
				{profiles.map((p, i) => (
					<button key={p.id} autoFocus={i === 0} onClick={() => void choose(p, onPick)}>
						<Avatar p={p} />
						{p.name}
					</button>
				))}
				<button className={s.add} onClick={() => void profileEdit(null, onPick)}>
					<Avatar p={{
						name: '+',
						color: 0,
					}} />
					{t`Add`}
				</button>
			</div>
		</section>
	);
}
