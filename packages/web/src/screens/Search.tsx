import { t } from '@lingui/core/macro';
import { useRef } from 'react';

import { get } from '../lib/api.ts';
import {
	Card,
	Grid,
	Section,
} from '../ui/Card.tsx';
import {
	useLanding,
	useLoad,
} from '../ui/load.ts';
import tx from '../ui/text.module.scss';
import p from './page.module.scss';

export function Search({ q }: { q: string }) {
	const items = useLoad(() => get('search', { q }), [q]);
	const ref = useRef<HTMLDivElement>(null);
	useLanding(ref, items);
	if (!items) return (
		<div className={p.pad}>
			<p className={tx.hint}>{t`Searching for “${q}”…`}</p>
		</div>
	);
	return (
		<>
			<div className={p.pad} />
			<Section title={q}>
				{items.length ? (
					<Grid ref={ref}>
						{items.map(i => <Card key={i.type + i.id} i={i} />)}
					</Grid>
				) : <p className={tx.empty}>{t`No title found. Try the original or English title.`}</p>}
			</Section>
		</>
	);
}
