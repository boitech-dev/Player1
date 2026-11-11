import type { ReactNode } from 'react';

import { cx } from './cx.ts';
import s from './Setting.module.scss';

/** one setting: its name and what it does (or its state, in tone) on the left, its control on the
 *  right */
export function Setting({
	title,
	says,
	tone,
	children,
}: { title: ReactNode; says?: ReactNode; tone?: string; children?: ReactNode }) {
	return (
		<div className={s.setting}>
			<div>
				<strong>{title}</strong>
				{says && <span className={cx(s.says, tone || s.quiet)}>{says}</span>}
			</div>
			{children}
		</div>
	);
}
