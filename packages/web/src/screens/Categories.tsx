import { t } from '@lingui/core/macro';
import { useRef } from 'react';

import type { Genres } from '@player1/shared/api';

import { get } from '../lib/api.ts';
import { Section } from '../ui/Card.tsx';
import {
	useLanding,
	useLoad,
} from '../ui/load.ts';
import s from './Categories.module.scss';
import p from './page.module.scss';

// categories: each tile shows its genre's top backdrop, its three most popular posters fanned

function Tile({
	g,
	k,
	name,
}: { g: Genres; k: string; name: string }) {
	const a = g.art[k] ?? { posters: [] };
	return (
		<a
			className={s.tile}
			href={`#/browse/${k}`}
			style={a.backdrop ? { backgroundImage: `url('${a.backdrop}')` } : undefined}
			data-land
		>
			<span className={s.name}>{name}</span>
			<span className={s.fan}>
				{a.posters.map(x => <img key={x} loading="lazy" src={x} alt="" />)}
			</span>
		</a>
	);
}

export function Categories() {
	const g = useLoad(() => get('genres'), []);
	const ref = useRef<HTMLDivElement>(null);
	useLanding(ref, g);
	if (!g) return <div className={p.pad} />;
	return (
		<div ref={ref}>
			<div className={p.pad} />
			<Section title={t`Picks`}>
				<div className={s.tiles}>
					{g.cats.map(c => <Tile key={c.key} g={g} k={c.key} name={c.title} />)}
				</div>
			</Section>
			<Section title={t`Movies`}>
				<div className={s.tiles}>
					{g.movie.map(x => <Tile key={x.id} g={g} k={`genre-movie-${x.id}`} name={x.name} />)}
				</div>
			</Section>
			<Section title={t`Series`}>
				<div className={s.tiles}>
					{g.tv.map(x => <Tile key={x.id} g={g} k={`genre-tv-${x.id}`} name={x.name} />)}
				</div>
			</Section>
		</div>
	);
}
