import { t } from '@lingui/core/macro';
import {
	type InputHTMLAttributes,
	type KeyboardEvent,
	type ReactNode,
	useEffect,
	useRef,
} from 'react';

import { Button } from './Button.tsx';
import { cx } from './cx.ts';
import {
	Icon,
	type IconName,
} from './Icon.tsx';
import { useSmoothHeight } from './smooth.ts';
import { Stack } from './Stack.tsx';
import s from './Wizard.module.scss';

// A few steps, one per screen: a card centered on the stage, a header saying how far along we are,
// and Back / Skip / Next under the step. The card glides to each step's size; the new step fades in.

/** how a passed step went, for the header's bar */
export type Mark = 'ok' | 'bad' | 'wait' | 'skip' | undefined;

interface Props {
	/** the step we're on, from 0, and each step's mark once passed */
	at: number;
	marks: Mark[];
	/** a greeting above the first step's card; it fades out after it */
	hello?: ReactNode;
	/** the card's ring: the current step's state */
	st?: string;
	/** a name for the step, so its content fades in when it changes */
	step: string;
	children: ReactNode;
	/** no handler: the button keeps its place, hidden */
	onBack?: () => void;
	onSkip?: () => void;
	onNext: () => void;
	/** Next can't be pressed (yet) */
	blocked?: boolean;
	/** Next is waiting on a check: it says so */
	checking?: boolean;
	/** the last step's Next reads Finish */
	last?: boolean;
	/** a class for the whole screen, to style what the steps hold */
	className?: string;
}

export function Wizard({
	at,
	marks,
	hello,
	st,
	step,
	children,
	onBack,
	onSkip,
	onNext,
	blocked,
	checking,
	last,
	className,
}: Props) {
	const panel = useRef<HTMLDivElement>(null);
	const body = useRef<HTMLDivElement>(null);
	useSmoothHeight(body);
	const n = at + 1;
	const total = marks.length;

	// a new step: back to the top, the cursor in its first field
	useEffect(() => {
		scrollTo(0, 0);
		panel.current?.querySelector<HTMLInputElement>('input:not(:disabled)')?.focus();
	}, [step]);

	// Enter in a field goes on, like Next
	const onKey = (e: KeyboardEvent) => {
		if (e.key !== 'Enter' || !(e.target instanceof HTMLInputElement) || blocked) return;
		e.preventDefault();
		onNext();
	};

	return (
		<section className={cx(s.wizard, className)} onKeyDown={onKey}>
			<div className={s.above}>
				<div className={s.head}>
					<b>Player1</b>
					<div
						className={s.prog}
						role="progressbar"
						aria-valuemin={1}
						aria-valuemax={total}
						aria-valuenow={n}
					>
						{marks.map((m, i) => (
							<i key={i} data-st={i < at ? m ?? 'skip' : undefined} className={i === at ? s.now : undefined} />
						))}
					</div>
					<span>{t`${n} of ${total}`}</span>
				</div>
				{hello && (
					<div className={cx(s.hello, at > 0 && s.gone)} aria-hidden={at > 0 || undefined}>
						{hello}
					</div>
				)}
			</div>
			<div className={s.panel} data-st={st} ref={panel}>
				<div className={s.body} ref={body}>
					<div key={step} className={s.step}>{children}</div>
				</div>
				<div className={s.go}>
					<Button
						tone="ghost"
						className={s.back}
						id="backBtn"
						style={{ visibility: onBack ? undefined : 'hidden' }}
						disabled={!onBack}
						onClick={onBack}
					>
						{t`Back`}
					</Button>
					<Button
						tone="ghost"
						id="skipBtn"
						style={{ visibility: onSkip ? undefined : 'hidden' }}
						disabled={!onSkip}
						onClick={onSkip}
					>
						{t`Skip`}
					</Button>
					<Button
						tone="lampe"
						id="nextBtn"
						disabled={blocked}
						aria-busy={checking || undefined}
						onClick={onNext}
					>
						<Stack show={checking ? 2 : Number(!!last)} inline>
							{t`Next`}
							{t`Finish`}
							{t`Checking…`}
						</Stack>
					</Button>
				</div>
			</div>
		</section>
	);
}

/** a step's title: its picture, its name, and a tag pushed to the right ("optional") */
export function StepTitle({
	icon,
	tag,
	children,
}: { icon: IconName; tag?: ReactNode; children: ReactNode }) {
	return (
		<h2 className={s.title}>
			<span className={s.visual}><Icon name={icon} /></span>
			{children}
			{tag && <small>{tag}</small>}
		</h2>
	);
}

/** what the step is about, under its title */
export const StepText = ({ children }: { children: ReactNode }) => (
	<p className={s.text}>{children}</p>
);

/** a labelled text field in a step */
export function StepField({
	label,
	...input
}: { label: string } & InputHTMLAttributes<HTMLInputElement>) {
	return (
		<label className={s.field}>
			{label}
			<input autoComplete="off" spellCheck={false} {...input} />
		</label>
	);
}

/** a small heading over a group of controls in a step */
export const StepLabel = ({ children }: { children: ReactNode }) => (
	<h3 className={s.label}>{children}</h3>
);
