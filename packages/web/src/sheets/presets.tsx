import { t } from '@lingui/core/macro';
import {
	useReducer,
	useRef,
} from 'react';
import { flushSync } from 'react-dom';

import type { PostRoutes } from '@player1/shared/api';
import { LANGS } from '@player1/shared/langs';

import {
	presetSays,
	setApp,
	useApp,
} from '../app/state.ts';
import { post } from '../lib/api.ts';
import { langName } from '../lib/format.ts';
import { uiLang } from '../lib/i18n.ts';
import { Button } from '../ui/Button.tsx';
import { Field } from '../ui/Field.tsx';
import {
	Choice,
	Seg,
} from '../ui/Seg.tsx';
import { Setting } from '../ui/Setting.tsx';
import {
	closeSheet,
	openSheet,
	Opt,
	Sheet,
} from '../ui/sheet.tsx';
import tx from '../ui/text.module.scss';
import { toast } from '../ui/toast.tsx';

// Language presets (per profile): the languages someone speaks or reads, in order. Editing works
// on a copy of the list, shared by the sheets below; "Save" sends every preset at once.

type Draft = PostRoutes['presets']['body']['presets'][number];

const says = (p: Draft) => presetSays({
	...p,
	id: p.id ?? '',
});

async function pickPreset(id: string) {
	setApp({ preset: id });
	closeSheet();
	await post('preset', { id }).catch((err: Error) => toast(err.message));
}

function PresetSheet() {
	const s = useApp();
	return (
		<Sheet title={t`Language`}>
			{s.presets.map(p => (
				<Opt
					key={p.id}
					title={p.name}
					sub={presetSays(p)}
					on={p.id === s.preset}
					onClick={() => void pickPreset(p.id)}
				/>
			))}
			<Opt
				title={t`Edit presets`}
				sub={t`The languages you speak or read, in order`}
				onClick={() => presetList(structuredClone(s.presets))}
			/>
		</Sheet>
	);
}

/** the header's language button: pick a preset, or edit them */
export const presetSheet = () => openSheet(<PresetSheet />);

async function savePresets(list: Draft[]) {
	try {
		const r = await post('presets', { presets: list });
		setApp({
			presets: r.presets,
			preset: r.preset,
		});
		closeSheet();
		toast(t`Presets saved`);
	} catch (err) {
		toast((err as Error).message);
	}
}

/** every preset, to edit one or add one */
export function presetList(list: Draft[]) {
	const add = () => {
		list.push({
			name: '',
			langs: [{ code: uiLang() }],
		});
		presetEdit(list, list.length - 1);
	};
	openSheet(
		<Sheet title={t`Presets`} onBack={presetSheet}>
			{list.map((p, i) => (
				<Opt key={i} title={p.name} sub={says(p)} onClick={() => presetEdit(list, i)} />
			))}
			<Opt title={t`New preset`} onClick={add} />
		</Sheet>,
	);
}

/** one preset: its name, its languages in order, each spoken or only read */
export const presetEdit = (list: Draft[], i: number) => openSheet(<PresetEdit list={list} i={i} />);

export type Move = 'spoken' | 'captioned' | 'up' | 'del';

/** one language of a preset: heard or only read, moved up, removed */
export function LangRow({
	code,
	captioned,
	j,
	onMove,
}: { code: string; captioned?: boolean; j: number; onMove: (j: number, v: Move) => void }) {
	const name = langName(code);
	return (
		<Setting title={name} says={captioned ? t`Subtitles only` : t`Audio or subtitles`}>
			<Seg label={name}>
				<Choice data-j={j} data-v="spoken" pressed={!captioned} onClick={() => onMove(j, 'spoken')}>
					{t`Spoken`}
				</Choice>
				<Choice
					data-j={j}
					data-v="captioned"
					pressed={!!captioned}
					onClick={() => onMove(j, 'captioned')}
				>
					{t`Captioned`}
				</Choice>
				<Choice
					data-j={j}
					data-v="up"
					aria-label={t`Move up`}
					disabled={!j}
					onClick={() => onMove(j, 'up')}
				>
					↑
				</Choice>
				<Choice data-j={j} data-v="del" aria-label={t`Remove`} onClick={() => onMove(j, 'del')}>
					✕
				</Choice>
			</Seg>
		</Setting>
	);
}

function PresetEdit({
	list,
	i,
}: { list: Draft[]; i: number }) {
	const p = list[i]!;
	const [, redraw] = useReducer((x: number) => x + 1, 0);
	const name = useRef<HTMLInputElement>(null);
	const back = () => presetList(list);

	// the draft is shared with the other sheets: change it, redraw, keep the focus on that row
	const move = (j: number, v: Move) => {
		if (v === 'del') p.langs.splice(j, 1);
		else if (v === 'up') p.langs.splice(j - 1, 0, ...p.langs.splice(j, 1));
		else p.langs[j]!.captioned = v === 'captioned';
		flushSync(redraw);
		const to = `[data-j="${Math.max(0, v === 'up' ? j - 1 : j)}"][data-v="${v === 'del' ? 'spoken' : v}"]`;
		document.querySelector<HTMLElement>('#sheet ' + to)?.focus();
	};
	const addLang = () => openSheet(
		<Sheet title={t`Add a language`} onBack={() => presetEdit(list, i)}>
			{Object.keys(LANGS).filter(c => !p.langs.some(l => l.code === c)).map(c => (
				<Opt
					key={c}
					title={langName(c)}
					onClick={() => {
						p.langs.push({ code: c });
						presetEdit(list, i);
					}}
				/>
			))}
		</Sheet>,
	);
	const save = () => {
		if (!p.name) return name.current?.focus();
		if (!p.langs.length) return toast(t`Add at least one language`);
		void savePresets(list);
	};
	const remove = () => {
		list.splice(i, 1);
		void savePresets(list);
	};

	return (
		<Sheet title={p.name || t`New preset`} onBack={back}>
			<Field>
				<input
					ref={name}
					id="presName"
					maxLength={30}
					defaultValue={p.name}
					placeholder={t`Preset name`}
					aria-label={t`Preset name`}
					onChange={e => p.name = e.target.value.trim()}
				/>
			</Field>
			<h5>{t`Languages, the one you prefer first`}</h5>
			{p.langs.map((l, j) => (
				<LangRow key={j} code={l.code} captioned={l.captioned} j={j} onMove={move} />
			))}
			<Opt title={t`Add a language`} onClick={addLang} />
			<h5>{t`What Player1 will look for, in this order`}</h5>
			<p className={tx.empty}>{says(p)}</p>
			<Field>
				<Button tone="lampe" onClick={save}>{t`Save`}</Button>
				{list.length > 1 && <Button tone="ghost" onClick={remove}>{t`Delete this preset`}</Button>}
			</Field>
		</Sheet>
	);
}
