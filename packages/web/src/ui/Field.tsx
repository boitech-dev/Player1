import type {
	FormEvent,
	ReactNode,
} from 'react';

import s from './Field.module.scss';

/** a text field and its button; Enter submits */
export function Field({
	onSubmit,
	children,
}: { onSubmit?: () => void; children: ReactNode }) {
	const submit = (e: FormEvent) => {
		e.preventDefault();
		onSubmit?.();
	};
	return <form className={s.field} onSubmit={submit}>{children}</form>;
}
