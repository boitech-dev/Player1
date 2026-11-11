import { t } from '@lingui/core/macro';
import {
	type ReactNode,
	useEffect,
	useRef,
	useSyncExternalStore,
} from 'react';

import { Button } from './Button.tsx';
import { cx } from './cx.ts';
import { Icon } from './Icon.tsx';
import s from './sheet.module.scss';

// Sheets: one native <dialog> (focus trap, Esc closes it) showing one sheet at a time. A sheet
// that leads to another passes `back`, which reopens the one it came from; the TV app's Back
// button takes it.

interface Open {
	node: ReactNode;
	key: number;
	/** sits at the top without dimming (subtitles stay visible while they're shifted) */
	peek?: boolean;
	onClose?: () => void;
}

let open: Open | null = null;
let n = 0;
let back: (() => void) | undefined;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach(l => l());
const subscribe = (l: () => void) => {
	listeners.add(l);
	return () => listeners.delete(l);
};

export function openSheet(node: ReactNode, opts: { peek?: boolean } = {}) {
	const was = open;
	open = {
		node,
		key: ++n,
		peek: opts.peek,
		onClose: was?.onClose,
	};
	changed();
}

export function closeSheet() {
	if (!open) return;
	const done = open.onClose;
	open = null;
	back = undefined;
	changed();
	done?.();
}

export const sheetOpen = () => !!open;

/** Back: a sub-sheet steps back to its parent, any other sheet closes. False if none is open. */
export function sheetBack() {
	if (!open) return false;
	if (back) back();
	else closeSheet();
	return true;
}

/** a sheet that answers: resolves with what was picked, or null once it closes without */
export function ask<T>(render: (done: (v: T) => void) => ReactNode): Promise<T | null> {
	return new Promise(resolve => {
		let answer: T | null = null;
		openSheet(render(v => {
			answer = v;
			closeSheet();
		}));
		open!.onClose = () => resolve(answer);
	});
}

/** the one <dialog>, mounted once */
export function SheetHost() {
	const o = useSyncExternalStore(subscribe, () => open);
	const ref = useRef<HTMLDialogElement>(null);
	useEffect(() => {
		const d = ref.current!;
		if (o && !d.open) d.showModal();
		if (!o && d.open) d.close();
	}, [o]);
	return (
		<dialog
			id="sheet"
			ref={ref}
			className={cx(s.sheet, o?.peek && s.peek)}
			onClose={closeSheet}
			onClick={e => e.target === e.currentTarget && closeSheet()}
		>
			{o && <div key={o.key}>{o.node}</div>}
		</dialog>
	);
}

/** a sheet's frame: title, Back when it has a parent, Close */
export function Sheet({
	title,
	onBack,
	children,
}: { title: string; onBack?: () => void; children: ReactNode }) {
	const body = useRef<HTMLDivElement>(null);
	useEffect(() => {
		back = onBack;
	});
	useEffect(() => {
		const b = body.current;
		const first = b?.querySelector<HTMLElement>('[data-current]')
			?? b?.querySelector<HTMLElement>('button, input');
		first?.focus();
	}, []);
	return (
		<>
			<div className={s.head}>
				{onBack && (
					<Button icon tone="ghost" onClick={onBack} aria-label={t`Back`}>
						<Icon name="back" />
					</Button>
				)}
				<h3>{title}</h3>
				<Button icon tone="ghost" onClick={closeSheet} aria-label={t`Close`}>
					<Icon name="close" />
				</Button>
			</div>
			<div className={s.body} ref={body}>{children}</div>
		</>
	);
}

/** one row in a sheet: optional leading badge, title, subtitle, a tick when it's the current one */
export function Opt({
	lead,
	title,
	sub,
	on,
	onClick,
	disabled,
}: {
	lead?: ReactNode;
	title: ReactNode;
	sub?: ReactNode;
	on?: boolean;
	onClick?: () => void;
	disabled?: boolean;
}) {
	return (
		<button className={s.opt} data-current={on || undefined} onClick={onClick} disabled={disabled}>
			{lead}
			<div>
				<strong>{title}</strong>
				{sub && <span>{sub}</span>}
			</div>
			{on && <span className={s.tick}><Icon name="check" /></span>}
		</button>
	);
}

/** a row's large leading text (a resolution: 4K, 1080p) */
export const Big = ({ children }: { children: ReactNode }) => (
	<span className={s.big}>{children}</span>
);
