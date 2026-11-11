import type { ReactNode } from 'react';

import type { StreamTag } from '@player1/shared/langs';

import { badge } from '../app/state.ts';
import { cx } from './cx.ts';
import s from './Tag.module.scss';

/** a badge: a tier's tag (VF, VOSTFR…) or any short text; dub draws it lit */
export function Badge({
	dub,
	className,
	children,
}: { dub?: boolean; className?: string; children: ReactNode }) {
	return <span className={cx(s.tag, dub && s.dub, className)}>{children}</span>;
}

/** a release's language badge, from what its name advertises */
export function Tag({
	tag,
	className,
}: { tag?: StreamTag; className?: string }) {
	const [kind, txt] = badge(tag);
	return <Badge dub={kind === 'dub'} className={className}>{txt}</Badge>;
}
