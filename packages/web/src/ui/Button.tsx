import type {
	AnchorHTMLAttributes,
	ButtonHTMLAttributes,
	Ref,
} from 'react';

import s from './Button.module.scss';
import { cx } from './cx.ts';

interface Look {
	/** lampe: the one main action of a screen; ghost: no background until hovered */
	tone?: 'lampe' | 'ghost';
	/** a round button holding only an icon */
	icon?: boolean;
	/** a state that's set */
	on?: boolean;
}

const look = ({
	tone,
	icon,
	on,
}: Look, className?: string) => cx(s.btn, tone && s[tone], icon && s.icon, on && s.on, className);

export function Button({
	tone,
	icon,
	on,
	className,
	ref,
	type = 'button',
	...rest
}: Look & ButtonHTMLAttributes<HTMLButtonElement> & { ref?: Ref<HTMLButtonElement> }) {
	return (
		<button
			ref={ref}
			type={type}
			className={look({
				tone,
				icon,
				on,
			}, className)}
			{...rest}
		/>
	);
}

/** a link that looks like a button */
export function ButtonLink({
	tone,
	icon,
	on,
	className,
	...rest
}: Look & AnchorHTMLAttributes<HTMLAnchorElement>) {
	return (
		<a
			className={look({
				tone,
				icon,
				on,
			}, className)}
			{...rest}
		/>
	);
}
