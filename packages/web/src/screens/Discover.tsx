import { t } from '@lingui/core/macro';
import {
	type PointerEvent,
	type Ref,
	useCallback,
	useEffect,
	useRef,
	useState,
} from 'react';

import type { Item } from '@player1/shared/api';

import {
	go,
	itemHash,
} from '../app/router.ts';
import { setApp } from '../app/state.ts';
import {
	get,
	post,
} from '../lib/api.ts';
import { touch } from '../lib/device.ts';
import {
	keep,
	load,
} from '../lib/store.ts';
import { Button } from '../ui/Button.tsx';
import { cx } from '../ui/cx.ts';
import { Icon } from '../ui/Icon.tsx';
import { Beam } from '../ui/Loading.tsx';
import tx from '../ui/text.module.scss';
import { toast } from '../ui/toast.tsx';
import { Trailer } from '../ui/Trailer.tsx';
import d from './Discover.module.scss';
import pg from './page.module.scss';

// Discover: one title at a time. Swipe right keeps it in the watchlist, left hides it for good;
// Later brings it back tomorrow, Seen it never again.

const KINDS = {
	all: () => t`All`,
	movie: () => t`Movies`,
	series: () => t`Series`,
	anime: () => t`Anime`,
};
type Kind = keyof typeof KINDS;
type Verdict = 'hide' | 'later' | 'keep' | 'seen';

const VERDICT: Record<Verdict, (title: string) => string> = {
	hide: title => t`${title} hidden`,
	later: title => t`${title} postponed to tomorrow`,
	keep: title => t`${title} added to your watchlist`,
	seen: title => t`${title} marked as seen`,
};
const AWAY: Record<Verdict, string> = {
	keep: 'translateX(140%) rotate(22deg)',
	hide: 'translateX(-140%) rotate(-22deg)',
	later: 'translateY(-130%)',
	seen: 'translateY(130%)',
};

const kindOf = (k?: string): Kind => k && k in KINDS
	? k as Kind
	: (load('dkind') as Kind | null) ?? 'all';
const kindName = (i: Item) => i.anime ? t`Anime` : i.type === 'movie' ? t`Movie` : t`Show`;

function Facts({ i }: { i: Item }) {
	return (
		<>
			<h2>{i.title}</h2>
			{i.sub && <p className={cx(pg.aka, d.aka)}>{i.sub}</p>}
			<div className={cx(pg.facts, d.facts)}>
				<span>{i.year}</span>
				<span>{kindName(i)}</span>
			</div>
			<p>{i.overview}</p>
		</>
	);
}

function Face({
	i,
	next,
	onPointerDown,
	onPointerMove,
	onPointerUp,
	cardRef,
}: {
	i: Item;
	next?: boolean;
	onPointerDown?: (e: PointerEvent<HTMLDivElement>) => void;
	onPointerMove?: (e: PointerEvent<HTMLDivElement>) => void;
	onPointerUp?: () => void;
	cardRef?: Ref<HTMLDivElement>;
}) {
	const title = i.title;
	return (
		<div
			ref={cardRef}
			className={cx(d.swipe, next && d.next)}
			tabIndex={next ? undefined : 0}
			role={next ? undefined : 'button'}
			aria-label={next ? undefined : t`See details: ${title}`}
			style={{ backgroundImage: `url('${i.poster?.replace('/w342/', '/w780/')}')` }}
			onKeyDown={e => e.key === 'Enter' && go(itemHash(i.type, i.id))}
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={onPointerUp}
			onPointerCancel={onPointerUp}
		>
			{!next && <span className={d.stamp} data-stamp="keep">{t`Watchlist`}</span>}
			{!next && <span className={d.stamp} data-stamp="hide">{t`Hide`}</span>}
			<div className={d.info}><Facts i={i} /></div>
		</div>
	);
}

/** the deck of titles and the verdicts on its top card */
function useDeck(kind: Kind) {
	const [deck, setDeck] = useState<Item[]>([]);
	const [ready, setReady] = useState(false);
	const refill = useCallback(async () => {
		const more = await get('discover', { kind });
		setDeck(d => {
			const ids = new Set(d.map(i => i.type + i.id));
			return [...d, ...more.filter(i => !ids.has(i.type + i.id))];
		});
		setReady(true);
	}, [kind]);
	useEffect(() => {
		setDeck([]);
		setReady(false);
		refill().catch((err: Error) => toast(err.message, 6000));
	}, [refill]);
	const shift = (i: Item, verdict: Verdict) => {
		post('swipe', {
			item: i,
			verdict,
		}).then(r => setApp({
			lists: r.lists,
			marked: r.marked,
		}), () => {});
		toast(VERDICT[verdict](i.title), 1600);
		setDeck(d => d.slice(1));
		if (deck.length < 6) refill().catch(() => {});
	};
	return {
		deck,
		ready,
		shift,
	};
}

export function Discover({ kind: asked }: { kind?: string }) {
	const kind = kindOf(asked);
	useEffect(() => keep('dkind', kind), [kind]);
	const { deck, ready, shift } = useDeck(kind);
	const card = useRef<HTMLDivElement>(null);
	const drag = useRef<{ x: number; dx: number } | null>(null);
	const keepBtn = useRef<HTMLButtonElement>(null);
	const [leaving, setLeaving] = useState<string>(); // the top card, from the verdict on
	const top = deck[0];
	const next = deck[1];
	const going = !!top && leaving === top.type + top.id;
	useEffect(() => {
		if (ready && !touch) keepBtn.current?.focus();
	}, [ready]);
	const decide = (verdict: Verdict) => {
		const el = card.current;
		if (!top) return;
		if (!el) return shift(top, verdict);
		setLeaving(top.type + top.id);
		const stamp = el.querySelector<HTMLElement>(`[data-stamp="${verdict}"]`);
		if (stamp && (verdict === 'keep' || verdict === 'hide')) stamp.style.opacity = '1';
		el.style.transition = 'transform .28s ease-in';
		el.style.transform = AWAY[verdict];
		setTimeout(() => shift(top, verdict), 260);
	};
	const stamps = (dx: number) => {
		const el = card.current!;
		el.style.transform = `translateX(${dx}px) rotate(${dx / 18}deg)`;
		const stamp = (k: string) => el.querySelector<HTMLElement>(`[data-stamp="${k}"]`)!;
		stamp('keep').style.opacity = String(Math.max(0, dx / 110));
		stamp('hide').style.opacity = String(Math.max(0, -dx / 110));
	};
	const down = (e: PointerEvent<HTMLDivElement>) => {
		drag.current = {
			x: e.clientX,
			dx: 0,
		};
		e.currentTarget.setPointerCapture(e.pointerId);
		e.currentTarget.style.transition = 'none';
	};
	const move = (e: PointerEvent<HTMLDivElement>) => {
		if (!drag.current) return;
		drag.current.dx = e.clientX - drag.current.x;
		stamps(drag.current.dx);
	};
	const up = () => {
		const d = drag.current;
		drag.current = null;
		if (!d || !top) return;
		if (Math.abs(d.dx) > 110) return decide(d.dx > 0 ? 'keep' : 'hide');
		if (Math.abs(d.dx) < 6) return go(itemHash(top.type, top.id));
		const el = card.current!;
		el.style.transition = 'transform .2s';
		el.style.transform = '';
		el.querySelectorAll<HTMLElement>('[data-stamp]').forEach(x => x.style.opacity = '0');
	};
	return (
		<section className={d.wrap}>
			<div className={d.bg} style={{ backgroundImage: top ? `url('${top.backdrop}')` : undefined }} />
			{next && <Trailer key={next.type + next.id} item={next} backdrop hidden={!going} />}
			{top && <Trailer key={top.type + top.id} item={top} backdrop hidden={going} />}
			<div className={d.kinds}>
				{(Object.keys(KINDS) as Kind[]).map(k => (
					<Button
						key={k}
						aria-pressed={k === kind}
						onClick={() => location.replace('#/discover/' + k)}
					>
						{KINDS[k]()}
					</Button>
				))}
			</div>
			<div className={d.main}>
				<div className={d.deck}>
					{next && <Face key={next.type + next.id} i={next} next={!going} />}
					{top && (
						<Face
							key={top.type + top.id}
							i={top}
							cardRef={card}
							onPointerDown={down}
							onPointerMove={move}
							onPointerUp={up}
						/>
					)}
					{!ready && <div className={d.none}><Beam /></div>}
					{ready && !top && (
						<p className={d.none}>
							{t`Nothing more to suggest for now. Change the filter or come back later.`}
						</p>
					)}
				</div>
				<div className={d.side}>
					<div className={d.details}>{top && <Facts i={top} />}</div>
					<div className={d.verdict}>
						<Button
							icon
							className={d.round}
							aria-label={t`Hide: never suggest again`}
							onClick={() => decide('hide')}
						>
							<Icon name="close" />
						</Button>
						<Button tone="ghost" className={d.quiet} onClick={() => decide('later')}>{t`Later`}</Button>
						<Button onClick={() => top && go(itemHash(top.type, top.id))}>
							{t`See details`}
						</Button>
						<Button tone="ghost" className={d.quiet} onClick={() => decide('seen')}>{t`Seen it`}</Button>
						<Button
							icon
							className={cx(d.round, d.keep)}
							ref={keepBtn}
							aria-label={t`Watchlist`}
							onClick={() => decide('keep')}
						>
							<Icon name="heart" filled />
						</Button>
					</div>
					{touch && (
						<p className={cx(tx.hint, d.hint)}>
							{t`Swipe right to add it to your watchlist, left to hide it.`}
						</p>
					)}
				</div>
			</div>
		</section>
	);
}
