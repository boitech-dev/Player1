import {
	useEffect,
	useRef,
	useState,
} from 'react';

import { cx } from './cx.ts';
import s from './PinField.module.scss';

/**
 * A PIN typed into four boxes, sent as soon as the fourth character is in. done answers whether it
 * was taken: a refused one shakes and empties the boxes.
 */
export function PinField({
	label,
	done,
	autoFocus,
}: { label: string; done: (pin: string) => Promise<boolean>; autoFocus?: boolean }) {
	const [pin, setPin] = useState('');
	const [shake, setShake] = useState(0);
	const input = useRef<HTMLInputElement>(null);
	// once its sheet is up: opening one focuses its first button
	useEffect(() => {
		if (!autoFocus) return;
		const t = setTimeout(() => input.current?.focus());
		return () => clearTimeout(t);
	}, [autoFocus]);
	// a refused one starts again, still focused
	useEffect(() => {
		if (shake) input.current?.focus();
	}, [shake]);
	const n = [...pin].length;
	const change = async (v: string) => {
		const typed = [...v].slice(0, 4).join('');
		setPin(typed);
		if ([...typed].length < 4) return;
		const ok = await done(typed);
		setPin('');
		if (!ok) setShake(x => x + 1);
	};
	return (
		<label key={shake} className={cx(s.pin, shake > 0 && s.shake)}>
			<input
				ref={input}
				type="password"
				value={pin}
				autoComplete="off"
				aria-label={label}
				onChange={e => void change(e.target.value)}
			/>
			{[0, 1, 2, 3].map(i => <span key={i} className={cx(i < n && s.full, i === n && s.at)} />)}
		</label>
	);
}
