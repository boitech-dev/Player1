import { t } from '@lingui/core/macro';
import { useState } from 'react';

import {
	FAVORITES,
	type Meta,
} from '@player1/shared/api';

import {
	setApp,
	useApp,
} from '../app/state.ts';
import { post } from '../lib/api.ts';
import { Button } from '../ui/Button.tsx';
import { Field } from '../ui/Field.tsx';
import {
	openSheet,
	Opt,
	Sheet,
} from '../ui/sheet.tsx';
import { toast } from '../ui/toast.tsx';

// the profile's own lists (favorites have their own button): tick to add or remove a title

const entry = (m: Meta) => ({
	id: m.id,
	type: m.type,
	title: m.title,
	sub: m.sub,
	year: m.year,
	poster: m.poster,
});

function Lists({ m }: { m: Meta }) {
	const { lists } = useApp();
	const [draft, setDraft] = useState('');
	const names = Object.keys(lists).filter(n => n !== FAVORITES);
	const has = (n: string) => !!lists[n]?.some(x => x.id === m.id);
	const toggle = async (n: string) => setApp({
		lists: await post('lists', {
			name: n,
			item: entry(m),
			on: !has(n),
		}),
	});
	const create = async () => {
		const name = draft.trim();
		if (!name) return;
		setApp({
			lists: await post('lists', {
				name,
				item: entry(m),
				on: true,
			}),
		});
		setDraft('');
		toast(t`Added to ${name}`);
	};
	return (
		<Sheet title={t`Lists`}>
			{names.map(l => {
				const n = lists[l]!.length;
				return (
					<Opt
						key={l}
						title={l}
						sub={n > 1 ? t`${n} titles` : t`${n} title`}
						on={has(l)}
						onClick={() => toggle(l)}
					/>
				);
			})}
			<Field onSubmit={create}>
				<input
					maxLength={40}
					value={draft}
					onChange={e => setDraft(e.target.value)}
					placeholder={t`New list`}
					aria-label={t`New list name`}
				/>
				<Button type="submit">{t`Create`}</Button>
			</Field>
		</Sheet>
	);
}

export const listsSheet = (m: Meta) => openSheet(<Lists m={m} />);

/** the favorites button */
export async function toggleFavorite(m: Meta, on: boolean) {
	setApp({
		lists: await post('lists', {
			name: FAVORITES,
			item: entry(m),
			on,
		}),
	});
	toast(on ? t`Added to favorites` : t`Removed from favorites`);
}
