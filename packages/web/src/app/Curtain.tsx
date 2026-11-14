import { t } from '@lingui/core/macro';
import { useState } from 'react';

import type { ProfileSummary } from '@player1/shared/api';

import { tv } from '../lib/device.ts';
import { Avatar } from '../screens/Who.tsx';
import { Button } from '../ui/Button.tsx';
import { cx } from '../ui/cx.ts';
import { Beam } from '../ui/Loading.tsx';
import s from './Curtain.module.scss';

/** a browser that hasn't been clicked yet won't let a trailer play with sound */
const asleep = () => !tv && !(navigator.userActivation?.hasBeenActive ?? true);

/** Down while the app starts or changes profile, so the page under it shows only once it has what
 *  it shows: the profile's face (or the marquee) and the beam. Where the browser hasn't been
 *  clicked yet, it waits on an Enter button instead of lifting: one press, and trailers have sound. */
export function Curtain({
	who,
	done,
	gate,
	onGone,
}: { who?: ProfileSummary; done: boolean; gate: boolean; onGone: () => void }) {
	const [entered, setEntered] = useState(false);
	const [waits] = useState(asleep);
	const up = done && (entered || !gate || !waits);
	return (
		<div
			className={cx(s.curtain, who && s.switching, up && s.up)}
			onTransitionEnd={e => up && e.target === e.currentTarget && onGone()}
		>
			{who ? (
				<div className={s.who}>
					<Avatar p={who} />
					<span>{who.name}</span>
				</div>
			) : <span className={s.brand}>Player1</span>}
			{done && gate && waits ? (
				<Button tone="lampe" className={s.enter} autoFocus onClick={() => setEntered(true)}>
					{t`Enter`}
				</Button>
			) : <Beam />}
		</div>
	);
}
