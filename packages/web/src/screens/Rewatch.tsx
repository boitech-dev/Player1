import { t } from '@lingui/core/macro';
import { useRef } from 'react';

import { useApp } from '../app/state.ts';
import { day } from '../lib/format.ts';
import { seen } from '../lib/resume.ts';
import {
	Card,
	Grid,
	Section,
} from '../ui/Card.tsx';
import { useLanding } from '../ui/load.ts';
import tx from '../ui/text.module.scss';
import p from './page.module.scss';

// Rewatch: every title seen through (or marked seen in Discover), latest first, films and series
// apart; the date it was seen under each

export function Rewatch() {
	const { progress, marked } = useApp();
	const all = seen(progress, marked);
	const ref = useRef<HTMLDivElement>(null);
	useLanding(ref, true);
	const group = (title: string, type: 'movie' | 'series') => {
		const items = all.filter(x => x.type === type);
		return !!items.length && (
			<Section title={title}>
				<Grid>
					{items.map(x => (
						<Card
							key={x.id}
							i={{
								...x,
								year: x.at ? day(x.at) : undefined,
							}}
						/>
					))}
				</Grid>
			</Section>
		);
	};
	return (
		<div ref={ref}>
			<div className={p.pad} />
			{all.length ? (
				<>
					{group(t`Movies`, 'movie')}
					{group(t`Series`, 'series')}
				</>
			) : (
				<Section title={t`Rewatch`}>
					<p className={tx.empty}>{t`What you finish watching shows up here.`}</p>
				</Section>
			)}
		</div>
	);
}
