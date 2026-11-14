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
	preload,
	useLanding,
	useLoad,
} from '../ui/load.ts';
import { Loading } from '../ui/Loading.tsx';
import {
	Trailer,
	usePreview,
} from '../ui/Trailer.tsx';
import p from './page.module.scss';

// home: the first trending title's backdrop and trailer, what's in progress, the lists, then the catalog rows

export function Home() {
	// with the featured title's backdrop, so the page comes whole
	const rows = useLoad(async () => {
		const r = await get('home');
		await preload(r[0]?.items.find(i => i.backdrop)?.backdrop);
		return r;
	}, []);
	const ref = useRef<HTMLDivElement>(null);
	useLanding(ref, rows);
	const previewing = !!usePreview(); // a card's trailer takes over
	if (!rows) return <Loading />;
	const f = rows[0]?.items.find(i => i.backdrop);
	return (
		<div ref={ref}>
			{f ? (
				<section className={p.hero} style={{ backgroundImage: `url('${f.backdrop}')` }}>
					<Trailer item={f} className={p.trailer} wait={0} hidden={previewing} />
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
			{rows.map(r => <Shelf key={r.key ?? r.title} title={r.title} items={r.items} more={r.key} />)}
		</div>
	);
}
