import { t } from '@lingui/core/macro';
import type {
	ReactNode,
	Ref,
} from 'react';

import {
	type Item,
	type ListEntry,
	WATCHLIST,
} from '@player1/shared/api';

import {
	itemHash,
	playHash,
} from '../app/router.ts';
import {
	listTitle,
	useApp,
} from '../app/state.ts';
import {
	episodeName,
	hms,
} from '../lib/format.ts';
import {
	seen,
	type Standing,
	standing,
} from '../lib/resume.ts';
import s from './Card.module.scss';
import { cx } from './cx.ts';
import { arrived } from './load.ts';
import { preview } from './Trailer.tsx';

type CardItem = Pick<Item, 'id' | 'type' | 'title' | 'sub' | 'poster'> & { year?: string };

/** a poster; pct draws how much was watched. Hovered or focused, its trailer plays behind the page */
export function Card({
	i,
	href,
	pct,
}: { i: CardItem; href?: string; pct?: number }) {
	return (
		<a
			className={s.card}
			href={href ?? itemHash(i.type, i.id)}
			data-land
			data-card={i.poster ? '' : undefined}
			onPointerEnter={e => e.pointerType === 'mouse' && preview(i)}
			onPointerLeave={() => preview()}
			onFocus={() => preview(i)}
			onBlur={() => preview()}
		>
			<span className={s.art}>
				{i.poster ? (
					<img loading="lazy" src={i.poster} alt="" onLoad={arrived} onError={arrived} />
				) : <span>{i.title}</span>}
				{!!pct && <i style={{ width: pct + '%' }} />}
			</span>
			<p>{i.title}</p>
			{i.sub && <small className={s.sub}>{i.sub}</small>}
			<small>{i.year}</small>
		</a>
	);
}

export function Shelf({
	title,
	items,
	more,
	children,
}: { title: string; items?: CardItem[]; more?: string; children?: ReactNode }) {
	if (!items?.length && !children) return null;
	return (
		<section className={s.shelf}>
			<h2>
				{title}
				{more && <a href={`#/browse/${more}`}>{t`See all`}</a>}
			</h2>
			<div className={s.row}>
				{items?.map(i => <Card key={i.type + i.id} i={i} />)}
				{children}
			</div>
		</section>
	);
}

const resumeCard = (p: Standing, tier?: string) => {
	const time = hms(p.dur - p.pos);
	const year = p.e ? `S${p.s} E${p.e}` : t`${time} left`;
	const href = playHash({
		type: p.type ?? 'movie',
		imdb: p.imdb ?? '',
		s: p.s,
		e: p.e,
		lang: p.lang,
		title: p.title ?? '',
		id: p.id,
		poster: p.poster,
		art: p.art,
		ep: p.e ? episodeName(p.s ?? 1, p.e) : '',
		tier,
	});
	return (
		<Card
			key={p.id}
			i={{
				id: p.id,
				type: p.type ?? 'movie',
				title: p.title ?? '',
				poster: p.poster,
				year,
			}}
			href={href}
			pct={p.dur ? Math.round(p.pos / p.dur * 100) : 0}
		/>
	);
};

/** what's in progress, latest first, one card per title: a film or episode to finish, or a
 *  series' next episode */
export function ResumeShelf() {
	const { progress, titleModes } = useApp();
	const items = standing(progress).slice(0, 20);
	if (!items.length) return null;
	return (
		<Shelf title={t`Resume`}>
			{items.map(p => resumeCard(p, titleModes[`${p.type}:${p.id}`]))}
		</Shelf>
	);
}

/** the profile's lists, favorites and watchlist first; the watchlist leaves out what's been seen
 *  (it's on Rewatch) */
export function ListShelves() {
	const { lists, progress, marked } = useApp();
	const done = new Set(seen(progress, marked).map(p => p.type + p.id));
	return Object.entries(lists).map(([n, l]: [string, ListEntry[]]) => (
		<Shelf
			key={n}
			title={listTitle(n)}
			items={n === WATCHLIST ? l.filter(x => !done.has(x.type + x.id)) : l}
		/>
	));
}

/** a titled section: a row of posters (Shelf) or anything else under a heading */
export function Section({
	title,
	children,
}: { title: ReactNode; children: ReactNode }) {
	return (
		<section className={s.shelf}>
			<h2>{title}</h2>
			{children}
		</section>
	);
}

/** posters in a grid that fills the width */
export function Grid({
	children,
	ref,
	className,
}: { children: ReactNode; ref?: Ref<HTMLDivElement>; className?: string }) {
	return <div className={cx(s.grid, className)} ref={ref}>{children}</div>;
}
