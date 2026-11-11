import { t } from '@lingui/core/macro';
import {
	useRef,
	useState,
} from 'react';

import {
	type ProfileSummary,
	UI_LANGS,
	type UiLang,
} from '@player1/shared/api';

import {
	app,
	myProfile,
	setApp,
	useApp,
} from '../app/state.ts';
import { post } from '../lib/api.ts';
import { uiLang } from '../lib/i18n.ts';
import {
	Avatar,
	AVATARS,
	COLORS,
} from '../screens/Who.tsx';
import { Button } from '../ui/Button.tsx';
import { Field } from '../ui/Field.tsx';
import {
	Choice,
	Seg,
} from '../ui/Seg.tsx';
import {
	closeSheet,
	openSheet,
	Opt,
	Sheet,
} from '../ui/sheet.tsx';
import { toast } from '../ui/toast.tsx';
import css from './profiles.module.scss';

/** the app's: remember this profile on this device and start again with it; null forgets it */
export type PickProfile = (id: string | null) => void;

/** each in its own language */
const LANG_NAMES: Record<UiLang, string> = {
	en: 'English',
	fr: 'Français',
};

function ProfilesSheet({ pick }: { pick: PickProfile }) {
	const s = useApp();
	const mine = myProfile(s);
	return (
		<Sheet title={t`Profiles`}>
			{s.profiles.map(p => (
				<Opt
					key={p.id}
					lead={<Avatar p={p} />}
					title={p.name}
					on={p.id === mine?.id}
					onClick={() => {
						closeSheet();
						if (p.id !== mine?.id) pick(p.id);
					}}
				/>
			))}
			<Opt
				title={t`Edit this profile`}
				sub={t`Name, picture, color, language`}
				onClick={() => profileEdit(mine ?? null, pick)}
			/>
			<Opt title={t`Add a profile`} onClick={() => profileEdit(null, pick)} />
		</Sheet>
	);
}

/** the header's profile sheet: switch, edit this one, add one */
export const profilesSheet = (pick: PickProfile) => openSheet(<ProfilesSheet pick={pick} />);

/** a profile's name, picture, color and interface language; null makes a new one */
export const profileEdit = (p: ProfileSummary | null, pick: PickProfile) =>
	openSheet(<ProfileEdit p={p} pick={pick} />);

/** a profile's color, one round button each */
export function ColorPicker({
	value,
	onChange,
}: { value: number; onChange: (i: number) => void }) {
	return (
		<div className={css.swatches}>
			{COLORS.map((c, i) => {
				const n = i + 1;
				return (
					<button
						key={c}
						type="button"
						style={{ background: c }}
						aria-label={t`Color ${n}`}
						aria-pressed={i === value}
						onClick={() => onChange(i)}
					/>
				);
			})}
		</div>
	);
}

/** a profile's picture, by family, each on the profile's color; the first is its initial */
export function AvatarPicker({
	name,
	color,
	value,
	onChange,
}: { name?: string; color: number; value?: string; onChange: (a: string) => void }) {
	const families: Record<string, string> = {
		people: t`People`,
		robots: t`Robots`,
		faces: t`Faces`,
		pixels: t`Pixels`,
	};
	const pick = (a: string, label: string) => (
		<button
			key={a}
			type="button"
			aria-label={label}
			aria-pressed={a === (value ?? '')}
			onClick={() => onChange(a)}
		>
			<Avatar p={{
				name: name ?? '',
				color,
				avatar: a,
			}} />
		</button>
	);
	return (
		<div className={css.avatars}>
			{Object.entries(families).map(([f, label]) => (
				<div key={f}>
					<h6>{label}</h6>
					<div>
						{f === 'people' && pick('', t`Initial`)}
						{Object.keys(AVATARS)
							.filter(a => a.startsWith(`${f}-`))
							.map((a, i) => pick(a, `${label} ${i + 1}`))}
					</div>
				</div>
			))}
		</div>
	);
}

/** the language the interface is shown in, each named in itself */
export function InterfaceLanguage({
	value,
	onChange,
}: { value: string; onChange: (l: UiLang) => void }) {
	return (
		<Seg>
			{UI_LANGS.map(k => (
				<Choice key={k} pressed={k === value} onClick={() => onChange(k)}>
					{LANG_NAMES[k]}
				</Choice>
			))}
		</Seg>
	);
}

function ProfileEdit({
	p,
	pick,
}: { p: ProfileSummary | null; pick: PickProfile }) {
	const [color, setColor] = useState(p?.color ?? app().profiles.length % COLORS.length);
	const [avatar, setAvatar] = useState(p?.avatar);
	const [lang, setLang] = useState(p?.lang || uiLang());
	const input = useRef<HTMLInputElement>(null);

	const submit = async () => {
		const name = input.current!.value.trim();
		if (!name) return input.current!.focus();
		try {
			const list = await post('profiles', {
				id: p?.id,
				name,
				color,
				avatar,
				lang,
			});
			closeSheet();
			if (!p) return pick(list.at(-1)!.id);
			// the whole interface changes language
			if (p.id === myProfile()?.id && lang !== uiLang()) return location.reload();
			setApp({ profiles: list });
		} catch (err) {
			toast((err as Error).message);
		}
	};

	return (
		<Sheet title={p ? t`Edit profile` : t`New profile`}>
			<Field onSubmit={() => void submit()}>
				<input
					ref={input}
					maxLength={24}
					defaultValue={p?.name ?? ''}
					placeholder={t`First name`}
					aria-label={t`Profile name`}
				/>
				<Button tone="lampe" type="submit">{p ? t`Save` : t`Create`}</Button>
			</Field>
			<h5>{t`Picture`}</h5>
			<div className={css.inset}>
				<AvatarPicker name={p?.name} color={color} value={avatar} onChange={setAvatar} />
			</div>
			<h5>{t`Color`}</h5>
			<div className={css.inset}><ColorPicker value={color} onChange={setColor} /></div>
			<h5>{t`Interface language`}</h5>
			<div className={css.inset}><InterfaceLanguage value={lang} onChange={setLang} /></div>
			{p && app().profiles.length > 1 && <DeleteProfile p={p} pick={pick} />}
		</Sheet>
	);
}

function DeleteProfile({
	p,
	pick,
}: { p: ProfileSummary; pick: PickProfile }) {
	const name = p.name;
	const remove = async () => {
		if (!confirm(t`Delete the profile ${name}?`)) return;
		try {
			await post('profiles', {
				id: p.id,
				remove: true,
			});
			closeSheet();
			pick(null);
		} catch (err) {
			toast((err as Error).message);
		}
	};
	return (
		<>
			<h5>{t`Delete`}</h5>
			<Opt
				title={t`Delete ${name}`}
				sub={t`Their lists and what they’ve watched are deleted too`}
				onClick={() => void remove()}
			/>
		</>
	);
}
