import { t } from '@lingui/core/macro';
import {
	useEffect,
	useState,
} from 'react';

import { post } from '../lib/api.ts';
import { me } from '../lib/device.ts';
import { toast } from '../ui/toast.tsx';
import s from './Pair.module.scss';

/** a new device: a code to type on a paired one; the page reloads once it's approved */
export function PairScreen() {
	const [code, setCode] = useState('');
	// a code expires after 10 minutes: a new round asks for a fresh one
	const [round, setRound] = useState(0);

	useEffect(() => {
		let stop = false;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const poll = async (secret: string) => {
			try {
				if ((await post('pair/poll', { secret })).ok) return location.reload();
			} catch {
				if (!stop) setRound(r => r + 1);
				return;
			}
			if (!stop) timer = setTimeout(() => void poll(secret), 2000);
		};
		post('pair', { name: me.name }).then(p => {
			if (stop) return;
			setCode(p.code);
			timer = setTimeout(() => void poll(p.secret), 2000);
		}, (err: Error) => toast(err.message));
		return () => {
			stop = true;
			clearTimeout(timer);
		};
	}, [round]);

	if (!code) return null;
	return (
		<section className={s.pair}>
			<small>{me.name.toLowerCase() === 'pc' ? t`Connect this PC` : t`Connect this device`}</small>
			<div className={s.code}>{code.slice(0, 3)} {code.slice(3)}</div>
			<p>{t`On your phone or PC, open Player1, go to Devices and type this code.`}</p>
		</section>
	);
}
