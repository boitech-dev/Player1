import { t } from '@lingui/core/macro';
import { useRef } from 'react';

import { itemHash } from '../app/router.ts';
import { get } from '../lib/api.ts';
import { ButtonLink } from '../ui/Button.tsx';
import {
	ListShelves,
	ResumeShelf,
	Shelf,
} from '../ui/Card.tsx';
import {
	useLanding,
	useLoad,
} from '../ui/load.ts';
import p from './page.module.scss';

// home: the first trending title's backdrop, what's in progress, the lists, then the catalog rows

export function Home() {
	const rows = useLoad(() => get('home'), []);
	const ref = useRef<HTMLDivElement>(null);
	useLanding(ref, rows);
	const f = rows?.[0]?.items.find(i => i.backdrop);
	return (
		<div ref={ref}>
			{f ? (
				<section className={p.hero} style={{ backgroundImage: `url('${f.backdrop}')` }}>
					<div>
						<h1 className={p.marquee}>{f.title}</h1>
						{f.sub && <p className={p.aka}>{f.sub}</p>}
						<p className={p.overview}>{f.overview}</p>
						<div className={p.actions}>
							<ButtonLink tone="lampe" href={itemHash(f.type, f.id)} data-land>
								{t`See details`}
							</ButtonLink>
						</div>
					</div>
				</section>
			) : <div className={p.pad} />}
			<ResumeShelf />
			<ListShelves />
			{rows?.map(r => <Shelf key={r.key ?? r.title} title={r.title} items={r.items} more={r.key} />)}
		</div>
	);
}
