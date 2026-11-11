import type { ReactNode } from 'react';

import s from './Stack.module.scss';

/**
 * Shows one of its children while every one of them keeps its place: the box is as big as the
 * biggest, so switching between them (a status that comes and goes, a button's label) never moves
 * anything around it.
 */
export function Stack({
	show,
	children,
	inline,
}: { show: number; children: ReactNode[]; inline?: boolean }) {
	return (
		<span className={inline ? `${s.stack} ${s.inline}` : s.stack}>
			{children.map((c, i) => <span key={i} aria-hidden={i !== show || undefined}>{c}</span>)}
		</span>
	);
}
