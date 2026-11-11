import { t } from '@lingui/core/macro';
import type {
	ReactNode,
	Ref,
} from 'react';

import type {
	Item,
	ListEntry,
	Progress,
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
import s from './Card.module.scss';
import { cx } from './cx.ts';

type CardItem = Pick<Item, 'id' | 'type' | 'title' | 'sub' | 'poster'> & { year?: string };

/** a poster; pct draws how much was watched */
export function Card({
	i,
	href,
	pct,
}: { i: CardItem; href?: string; pct?: number }) {
	return (
		<a className={s.card} href={href ?? itemHash(i.type, i.id)} data-land>
			<span className={s.art}>
				{i.poster ? <img loading="lazy" src={i.poster} alt="" /> : <span>{i.title}</span>}
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

const resumeCard = (p: Progress & { id: string }, tier?: string) => {
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

/** films and episodes started but not finished, latest first, one card per title */
export function ResumeShelf() {
	const { progress, titleModes } = useApp();
	const seen = new Set<string>();
	const items = Object.values(progress)
		.filter((p): p is Progress & { id: string } => !p.watched && p.pos > 30 && !!p.id)
		.sort((a, b) => b.at - a.at)
		.filter(p => !seen.has(p.id) && !!seen.add(p.id))
		.slice(0, 20);
	if (!items.length) return null;
	return (
		<Shelf title={t`Resume`}>
			{items.map(p => resumeCard(p, titleModes[`${p.type}:${p.id}`]))}
		</Shelf>
	);
}

/** the profile's lists, favorites and watchlist first */
export function ListShelves() {
	const { lists } = useApp();
	return Object.entries(lists).map(([n, l]: [string, ListEntry[]]) => (
		<Shelf key={n} title={listTitle(n)} items={l} />
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
