import { t } from '@lingui/core/macro';
import {
	useCallback,
	useEffect,
	useRef,
	useState,
} from 'react';

import type { Item } from '@player1/shared/api';

import { get } from '../lib/api.ts';
import { Button } from '../ui/Button.tsx';
import {
	Card,
	Grid,
	Section,
} from '../ui/Card.tsx';
import { useLanding } from '../ui/load.ts';
import { toast } from '../ui/toast.tsx';
import p from './page.module.scss';

// "See all": one category as an endless grid, the next page loading before the end comes up

export function Browse({ cat }: { cat: string }) {
	const [title, setTitle] = useState('');
	const [items, setItems] = useState<Item[]>([]);
	const [more, setMore] = useState(false);
	const page = useRef(0);
	const busy = useRef(false);
	const btn = useRef<HTMLButtonElement>(null);
	const grid = useRef<HTMLDivElement>(null);
	const next = useCallback(async () => {
		if (busy.current) return;
		busy.current = true;
		try {
			const r = await get('browse', {
				key: cat,
				page: ++page.current,
			});
			setTitle(r.title);
			setItems(x => [...x, ...r.items]);
			setMore(!!r.more);
		} catch (err) {
			toast((err as Error).message, 6000);
		} finally {
			busy.current = false;
		}
	}, [cat]);
	useEffect(() => {
		page.current = 0;
		setItems([]);
		next();
	}, [next]);
	useEffect(() => {
		const io = new IntersectionObserver(es => {
			if (es[0]?.isIntersecting) next();
		}, { rootMargin: '800px' });
		if (btn.current && more) io.observe(btn.current);
		return () => io.disconnect();
	}, [more, next]);
	useLanding(grid, items.length > 0);
	return (
		<>
			<div className={p.pad} />
			<Section title={title}>
				<Grid ref={grid}>
					{items.map(i => <Card key={i.type + i.id} i={i} />)}
				</Grid>
				<div className={p.more}>
					<Button ref={btn} hidden={!more} onClick={next}>{t`Show more`}</Button>
				</div>
			</Section>
		</>
	);
}
