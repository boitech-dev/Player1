import type { ReactNode } from 'react';

import { Button } from './Button.tsx';
import { cx } from './cx.ts';
import s from './Seg.module.scss';

/** a few choices side by side; pressed marks the current one */
export function Seg({
	label,
	className,
	children,
}: { label?: string; className?: string; children: ReactNode }) {
	return <div className={cx(s.seg, className)} role="group" aria-label={label}>{children}</div>;
}

/** one choice of a Seg */
export function Choice({
	pressed,
	...rest
}: { pressed?: boolean } & Parameters<typeof Button>[0]) {
	return <Button aria-pressed={pressed} {...rest} />;
}
