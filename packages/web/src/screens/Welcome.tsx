import { t } from '@lingui/core/macro';
import { useState } from 'react';

import type {
	PostRoutes,
	UiLang,
} from '@player1/shared/api';
import {
	choosableTiers,
	LANGS,
	type PresetLang,
	tierTag,
} from '@player1/shared/langs';

import {
	app,
	myProfile,
	presetSays,
	setApp,
} from '../app/state.ts';
import { post } from '../lib/api.ts';
import { langName } from '../lib/format.ts';
import { uiLang } from '../lib/i18n.ts';
import { tierSays } from '../lib/tiers.ts';
import {
	LangRow,
	type Move,
} from '../sheets/presets.tsx';
import {
	AvatarPicker,
	ColorPicker,
	InterfaceLanguage,
} from '../sheets/profiles.tsx';
import { Button } from '../ui/Button.tsx';
import { Icon } from '../ui/Icon.tsx';
import { Opt } from '../ui/sheet.tsx';
import { Badge } from '../ui/Tag.tsx';
import { toast } from '../ui/toast.tsx';
import {
	StepField,
	StepLabel,
	StepText,
	StepTitle,
	Wizard,
} from '../ui/Wizard.tsx';
import css from './Welcome.module.scss';

// A profile's first visit, in the same frame as the server's setup: who they are (a new install's
// first person only: an added profile was just named), the languages they watch in, then the idea
// of keeping several presets. The server remembers how far they got (state.welcome).

type Draft = PostRoutes['presets']['body']['presets'][number];
type Step = 'profile' | 'languages' | 'more';

// --- a preset's languages: add, order, heard or read, and what that gives ---

function Languages({
	langs,
	onChange,
}: { langs: PresetLang[]; onChange: (l: PresetLang[]) => void }) {
	const move = (j: number, v: Move) => {
		const next = langs.map(l => ({ ...l }));
		if (v === 'del') next.splice(j, 1);
		else if (v === 'up') next.splice(j - 1, 0, ...next.splice(j, 1));
		else next[j] = v === 'captioned' ? {
			code: next[j]!.code,
			captioned: true,
		} : { code: next[j]!.code };
		onChange(next);
	};
	const free = Object.keys(LANGS).filter(c => !langs.some(l => l.code === c));
	return (
		<>
			<div className={css.rows}>
				{langs.map((l, j) => (
					<LangRow key={l.code} code={l.code} captioned={l.captioned} j={j} onMove={move} />
				))}
			</div>
			{free.length > 0 && (
				<>
					<StepLabel>{t`Add a language`}</StepLabel>
					<div className={css.chips}>
						{free.map(c => (
							<Button key={c} onClick={() => onChange([...langs, { code: c }])}>{langName(c)}</Button>
						))}
					</div>
				</>
			)}
			{langs.length > 0 && (
				<>
					<StepLabel>{t`For each film, Player1 will look for, in this order:`}</StepLabel>
					<ol className={css.order}>
						{choosableTiers(langs).map(tier => (
							<li key={tier}>
								<Badge dub={tier.startsWith('dub')}>{tierTag(tier)}</Badge>
								{tierSays(tier)}
							</li>
						))}
					</ol>
				</>
			)}
		</>
	);
}

// --- the steps ---

interface Me {
	name: string;
	color: number;
	avatar?: string;
	lang: UiLang;
}

function ProfileStep({
	me,
	onChange,
}: { me: Me; onChange: (m: Partial<Me>) => void }) {
	return (
		<>
			<StepTitle icon="users">{t`Your profile`}</StepTitle>
			<StepText>
				{t`Each person at home has their own lists, languages and progress. This one is yours.`}
			</StepText>
			<StepField
				label={t`First name`}
				maxLength={24}
				value={me.name}
				onChange={e => onChange({ name: e.target.value })}
			/>
			<StepLabel>{t`Picture`}</StepLabel>
			<AvatarPicker
				name={me.name}
				color={me.color}
				value={me.avatar}
				onChange={avatar => onChange({ avatar })}
			/>
			<StepLabel>{t`Color`}</StepLabel>
			<ColorPicker value={me.color} onChange={color => onChange({ color })} />
			<StepLabel>{t`Interface language`}</StepLabel>
			<InterfaceLanguage value={me.lang} onChange={lang => onChange({ lang })} />
		</>
	);
}

function LanguagesStep({
	langs,
	onChange,
}: { langs: PresetLang[]; onChange: (l: PresetLang[]) => void }) {
	const how = t`Add the languages you know, your favorite first. For each one, choose whether you want to hear it or only read it in subtitles.`;
	return (
		<>
			<StepTitle icon="audio">{t`Your languages`}</StepTitle>
			<StepText>{how}</StepText>
			<Languages langs={langs} onChange={onChange} />
		</>
	);
}

/** a preset being added or changed, inside the last step */
function Editing({
	draft,
	onDone,
	onCancel,
}: { draft: Draft; onDone: (d: Draft) => void; onCancel: () => void }) {
	const [d, setD] = useState(draft);
	const done = () => {
		const name = d.name.trim();
		if (!name) return toast(t`Give it a name`);
		if (!d.langs.length) return toast(t`Add at least one language`);
		onDone({
			...d,
			name,
		});
	};
	return (
		<div className={css.editing}>
			<StepField
				label={t`Preset name`}
				maxLength={30}
				value={d.name}
				autoFocus
				onChange={e => setD({
					...d,
					name: e.target.value,
				})}
			/>
			<StepLabel>{t`Languages, the one you prefer first`}</StepLabel>
			<Languages
				langs={d.langs}
				onChange={langs => setD({
					...d,
					langs,
				})}
			/>
			<div className={css.done}>
				<Button tone="lampe" onClick={done}>{t`Save`}</Button>
				<Button tone="ghost" onClick={onCancel}>{t`Cancel`}</Button>
			</div>
		</div>
	);
}

const sameLangs = (a: PresetLang[], b: PresetLang[]) => a.length === b.length
	&& a.every((l, i) => l.code === b[i]!.code && !!l.captioned === !!b[i]!.captioned);

function MoreStep({
	presets,
	onChange,
	editing,
	setEditing,
}: {
	presets: Draft[];
	onChange: (p: Draft[]) => void;
	editing: number | null;
	setEditing: (i: number | null) => void;
}) {
	const base = presets[0]!.langs;
	// the same languages, never dubbed: the most common second way of watching
	const original = base.map(l => ({
		code: l.code,
		captioned: true,
	}));
	const offerOriginal = !presets.some(p => sameLangs(p.langs, original));
	const says = (p: Draft) => presetSays({
		...p,
		id: p.id ?? '',
	});
	const blank: Draft = {
		name: '',
		langs: base.map(l => ({ ...l })),
	};
	const what = t`What you just set up is a preset. You can keep several and switch from the top of the screen: one for you, one for watching with the kids, one to practise a language.`;
	return (
		<>
			<StepTitle icon="list">{t`More presets`}</StepTitle>
			<StepText>{what}</StepText>
			{editing === null ? (
				<div className={css.presets}>
					{presets.map((p, i) => (
						<Opt key={i} title={p.name} sub={says(p)} on={i === 0} onClick={() => setEditing(i)} />
					))}
					{offerOriginal && (
						<Opt
							lead={<span className={css.plus}><Icon name="plus" /></span>}
							title={t`Original version`}
							sub={t`Never dubbed: the original voices, with subtitles`}
							onClick={() => onChange([...presets, {
								name: t`Original version`,
								langs: original,
							}])}
						/>
					)}
					<Opt
						lead={<span className={css.plus}><Icon name="plus" /></span>}
						title={t`Make your own`}
						sub={t`Choose its languages yourself`}
						onClick={() => setEditing(presets.length)}
					/>
				</div>
			) : (
				<Editing
					draft={presets[editing] ?? blank}
					onCancel={() => setEditing(null)}
					onDone={d => {
						const next = [...presets];
						next[editing] = d;
						onChange(next);
						setEditing(null);
					}}
				/>
			)}
		</>
	);
}

// --- the flow ---

const DEFAULT_NAMES = ['Profile 1', 'Profil 1'];

/** a language's name in itself: what a preset is called until someone names it */
const ownName = (code: string) => {
	const n = new Intl.DisplayNames([code], { type: 'language' }).of(code) ?? code;
	return n[0]!.toUpperCase() + n.slice(1);
};
const autoNamed = (name: string) => Object.keys(LANGS).some(c => ownName(c) === name);

/** the first preset with these languages; still named after its first language unless renamed */
const withLangs = (p: Draft, langs: PresetLang[]): Draft => ({
	...p,
	langs,
	name: autoNamed(p.name) && langs[0] ? ownName(langs[0].code) : p.name,
});

/** the greeting above the first step: a new install's first person, or a profile just added */
function Greeting({
	all,
	name,
}: { all: boolean; name: string }) {
	return all ? (
		<>
			<h1>{t`Welcome`}</h1>
			<p>{t`Now, about you.`}</p>
		</>
	) : (
		<>
			<h1>{t`Hello ${name}`}</h1>
			<p>{t`Let’s set up your languages.`}</p>
		</>
	);
}

/** what the person has entered so far, and how each step is saved */
function useWelcome() {
	const mine = myProfile();
	const [me, set] = useState<Me>({
		name: mine && !DEFAULT_NAMES.includes(mine.name) ? mine.name : '',
		color: mine?.color ?? 0,
		avatar: mine?.avatar,
		lang: uiLang(),
	});
	const setMe = (patch: Partial<Me>) => set(m => ({
		...m,
		...patch,
	}));
	const [presets, setPresets] = useState<Draft[]>(() => structuredClone(app().presets));

	const savePresets = async (list = presets) => {
		const r = await post('presets', { presets: list });
		setPresets(r.presets);
		setApp({
			presets: r.presets,
			preset: r.preset,
		});
	};
	const save: Record<Step, () => Promise<void>> = {
		async profile() {
			const profiles = await post('profiles', {
				id: mine?.id,
				...me,
				name: me.name.trim(),
			});
			// the starting preset was made for the first device's language: it follows the one chosen
			const first = presets[0];
			const untouched = presets.length === 1 && first?.langs.length === 1 && autoNamed(first.name);
			if (untouched && first.langs[0]!.code !== me.lang && LANGS[me.lang]) {
				await savePresets([withLangs(first, [{ code: me.lang }])]);
			}
			await post('welcome', { done: 'profile' });
			// the whole interface changes language: the welcome picks up at the languages
			if (me.lang !== uiLang()) return location.reload();
			setApp({
				profiles,
				welcome: 'languages',
			});
		},
		languages: () => savePresets(),
		async more() {
			await savePresets();
			await post('welcome', { done: 'languages' });
			setApp({ welcome: undefined });
		},
	};
	return {
		me,
		setMe,
		presets,
		setPresets,
		save,
		name: me.name.trim() || mine?.name || '',
	};
}

export function Welcome() {
	// what was left to do when this screen opened: it doesn't change under the steps
	const [all] = useState(() => app().welcome === 'all');
	const steps: Step[] = all ? ['profile', 'languages', 'more'] : ['languages', 'more'];
	const w = useWelcome();
	const [at, setAt] = useState(0);
	const [busy, setBusy] = useState(false);
	const [editing, setEditing] = useState<number | null>(null);
	const step = steps[at]!;
	const langs = w.presets[0]?.langs ?? [];

	const next = async () => {
		setBusy(true);
		try {
			await w.save[step]();
			if (at < steps.length - 1) setAt(at + 1);
		} catch (err) {
			toast((err as Error).message);
		} finally {
			setBusy(false);
		}
	};
	const ready: Record<Step, boolean> = {
		profile: !!w.me.name.trim(),
		languages: langs.length > 0,
		more: editing === null,
	};
	const setLangs = (l: PresetLang[]) => w.setPresets([
		withLangs(w.presets[0]!, l),
		...w.presets.slice(1),
	]);

	return (
		<Wizard
			at={at}
			marks={steps.map(() => 'ok')}
			hello={<Greeting all={all} name={w.name} />}
			step={step}
			onBack={at && editing === null ? () => setAt(at - 1) : undefined}
			onNext={() => void next()}
			blocked={busy || !ready[step]}
			last={at === steps.length - 1}
		>
			{step === 'profile' && <ProfileStep me={w.me} onChange={w.setMe} />}
			{step === 'languages' && <LanguagesStep langs={langs} onChange={setLangs} />}
			{step === 'more' && (
				<MoreStep
					presets={w.presets}
					onChange={w.setPresets}
					editing={editing}
					setEditing={setEditing}
				/>
			)}
		</Wizard>
	);
}
