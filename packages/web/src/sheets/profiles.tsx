import { t } from '@lingui/core/macro';
import {
	type ReactNode,
	useRef,
	useState,
} from 'react';

import {
	MAX_AGES,
	type PostRoutes,
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
import {
	get,
	post,
} from '../lib/api.ts';
import { ageSays } from '../lib/format.ts';
import { uiLang } from '../lib/i18n.ts';
import {
	keepPin,
	pinToken,
} from '../lib/store.ts';
import {
	Avatar,
	AVATARS,
	COLORS,
} from '../screens/Who.tsx';
import { Button } from '../ui/Button.tsx';
import { Field } from '../ui/Field.tsx';
import { Icon } from '../ui/Icon.tsx';
import { idle } from '../ui/load.ts';
import { Beam } from '../ui/Loading.tsx';
import { PinField } from '../ui/PinField.tsx';
import {
	Choice,
	Seg,
} from '../ui/Seg.tsx';
import { Setting } from '../ui/Setting.tsx';
import {
	ask,
	closeSheet,
	Group,
	openSheet,
	Opt,
	Row,
	Sheet,
} from '../ui/sheet.tsx';
import { toast } from '../ui/toast.tsx';
import css from './profiles.module.scss';

// The profiles sheet (the header's avatar): switch to another profile, open this one's settings,
// add one. A profile's settings: a hub of rows, each opening a sheet of its own that saves at
// once.

/** the app's: remember this profile on this device and start again with it; null forgets it */
export type PickProfile = (id: string | null) => void;

/** each in its own language */
const LANG_NAMES: Record<UiLang, string> = {
	en: 'English',
	fr: 'Français',
};

/** a profile in a few words: its age limit, its PINs */
function profileSays(p: ProfileSummary) {
	const age = p.maxAge;
	const says = [age != null && t`Up to ${ageSays(age)}`, (p.lock || p.guard) && t`Protected`];
	return says.filter(Boolean).join(' · ');
}
/** a profile held to an age limit sets none, and adds no profile */
const free = () => myProfile()?.maxAge == null;
const failed = (err: unknown) => toast((err as Error).message);

const unlockWith = async (id: string, pin: string, settings?: boolean) => (await post('unlock', {
	id,
	pin,
	settings,
})).token;

// --- asking a PIN ---

/** a profile's PIN (settings: the one its settings ask), asked in a sheet: its token, or null once
 *  the sheet closes without it */
export const askPin = (p: ProfileSummary, settings?: boolean) =>
	ask<string>(done => <PinSheet p={p} settings={settings} done={done} />);
function PinSheet({
	p,
	settings,
	done,
}: { p: ProfileSummary; settings?: boolean; done: (token: string) => void }) {
	const name = p.name;
	const tryPin = async (pin: string) => {
		try {
			done(await unlockWith(p.id, pin, settings));
			return true;
		} catch (err) {
			failed(err);
			return false;
		}
	};
	return (
		<Sheet title={settings ? t`${name}’s settings` : name}>
			<div className={css.ask}>
				<Avatar p={p} />
				<p>{settings ? t`Type the PIN that protects these settings` : t`Type this profile’s PIN`}</p>
				<PinField label={t`PIN`} done={tryPin} autoFocus />
			</div>
		</Sheet>
	);
}

/** this device's profile held to an age limit, and keeping it with a PIN: that PIN's token, asked
 *  before leaving it for an open profile or making a new one; undefined when there's nothing to
 *  ask, null when it wasn't given */
async function leave() {
	const me = myProfile();
	return me?.maxAge != null && me.guard ? askPin(me, true) : undefined;
}

/** switch to a profile: its PIN first, when it has one to open it; leaving a profile held to an
 *  age limit for one without, that profile's settings PIN */
export async function choose(p: ProfileSummary, pick: PickProfile) {
	if (!p.lock && await leave() === null) return;
	if (p.lock) {
		const token = await askPin(p);
		if (!token) return;
		keepPin(token, p.lock === 'open');
	}
	pick(p.id);
}

// --- the profiles sheet ---

function ProfilesSheet({ pick }: { pick: PickProfile }) {
	const s = useApp();
	const mine = myProfile(s);
	return (
		<Sheet title={t`Profiles`}>
			<div className={css.tiles}>
				{s.profiles.map(p => (
					<button
						key={p.id}
						className={css.tile}
						aria-current={p.id === mine?.id || undefined}
						data-current={p.id === mine?.id || undefined}
						onClick={() => {
							closeSheet();
							if (p.id !== mine?.id) void choose(p, pick);
						}}
					>
						<Avatar p={p} />
						<strong>{p.name}</strong>
						<small>
							{p.lock && <Icon name="lock" />}
							{p.maxAge != null && ageSays(p.maxAge)}
						</small>
					</button>
				))}
				<button className={`${css.tile} ${css.add}`} onClick={() => void profileEdit(null, pick)}>
					<span><Icon name="plus" /></span>
					<strong>{t`Add`}</strong>
					<small />
				</button>
			</div>
			{mine && (
				<Group>
					<Row
						icon="face"
						title={t`Edit ${mine.name}’s profile`}
						sub={profileSays(mine) || t`Name, picture, language, PIN, age limit`}
						onClick={() => void profileEdit(mine, pick)}
					/>
				</Group>
			)}
		</Sheet>
	);
}

/** the header's profile sheet: switch, this one's settings, add one */
export const profilesSheet = (pick: PickProfile) => openSheet(<ProfilesSheet pick={pick} />);

/** a profile's settings (its settings PIN first, when they ask one), or a new profile (null) */
export async function profileEdit(p: ProfileSummary | null, pick: PickProfile) {
	if (!p) {
		const auth = await leave();
		if (auth !== null) openSheet(<NewProfile pick={pick} auth={auth} />);
		return;
	}
	const self = p.id === myProfile()?.id;
	// its settings' PIN; else, from another profile, the one that opens it
	const needs = p.guard ? 'settings' : p.lock && !self ? 'open' : null;
	const auth = needs ? await askPin(p, needs === 'settings') : undefined;
	if (auth === null) return;
	editing = {
		id: p.id,
		auth,
		pick,
	};
	hub();
}

// --- a profile's settings: what's being edited, and with which token ---
let editing = {
	id: '',
	auth: undefined as string | undefined,
	pick: (() => {}) as PickProfile,
};
const hub = () => openSheet(<ProfileHub />);
const edited = (s = app()) => s.profiles.find(p => p.id === editing.id);
/** saves at once; the new list, or null when it was refused */
async function change(body: Omit<PostRoutes['profiles']['body'], 'id' | 'auth'>) {
	try {
		const profiles = await post('profiles', {
			id: editing.id,
			auth: editing.auth,
			...body,
		});
		setApp({ profiles });
		return profiles;
	} catch (err) {
		failed(err);
		return null;
	}
}

function ProfileHub() {
	const s = useApp();
	const p = edited(s);
	const input = useRef<HTMLInputElement>(null);
	if (!p) return null;
	const self = p.id === myProfile(s)?.id;
	const name = p.name;
	const rename = async () => {
		const n = input.current!.value.trim();
		if (n && n !== p.name && await change({ name: n })) toast(t`Saved`, 1500);
	};
	const language = async (lang: UiLang) => {
		if (await change({ lang }) && self && lang !== uiLang()) location.reload();
	};
	const limit = p.maxAge;
	return (
		<Sheet title={t`Profile`} onBack={() => profilesSheet(editing.pick)}>
			<div className={css.hero}>
				<Field onSubmit={() => void rename()}>
					<input
						ref={input}
						maxLength={24}
						defaultValue={p.name}
						aria-label={t`Profile name`}
					/>
					<Button type="submit">{t`Rename`}</Button>
				</Field>
			</div>
			<Group>
				<Row
					lead={<span className={css.lead48}><Avatar p={p} /></span>}
					title={t`Picture and color`}
					first
					onClick={() => openSheet(<PictureSheet />)}
				/>
				<Setting title={t`Interface language`}>
					<InterfaceLanguage value={p.lang || uiLang()} onChange={l => void language(l)} />
				</Setting>
			</Group>
			<Group title={t`Protection`}>
				<Row
					icon="lock"
					title={t`PIN code`}
					sub={t`Profile access`}
					onClick={() => openSheet(<OpenPinSheet />)}
				/>
				<Row
					icon="shield"
					title={t`PIN code for settings`}
					sub={t`Protects the profile configuration`}
					onClick={() => openSheet(<SettingsPinSheet />)}
				/>
				<Row
					icon="age"
					title={t`Age limit`}
					value={limit == null ? t`None` : t`Up to ${ageSays(limit)}`}
					onClick={() => openSheet(<AgeSheet />)}
				/>
			</Group>
			{limit != null && !p.guard && <Unguarded />}
			{s.profiles.length > 1 && free() && (
				<Group>
					<Row icon="trash" bad title={t`Delete ${name}`} onClick={() => void remove(p)} />
				</Group>
			)}
		</Sheet>
	);
}

async function remove(p: ProfileSummary) {
	const name = p.name;
	const sure = t`Delete the profile ${name}? Their lists and what they’ve watched go with it.`;
	if (!confirm(sure)) return;
	try {
		await post('profiles', {
			id: p.id,
			remove: true,
			auth: editing.auth,
		});
		closeSheet();
		editing.pick(null);
	} catch (err) {
		failed(err);
	}
}

/** a sheet of the hub: Back returns to it */
function Sub({
	title,
	children,
}: { title: string; children: ReactNode }) {
	return <Sheet title={title} onBack={hub}>{children}</Sheet>;
}

function PictureSheet() {
	const p = edited(useApp());
	if (!p) return null;
	return (
		<Sub title={t`Picture and color`}>
			<div className={css.preview}><Avatar p={p} /></div>
			<h5>{t`Color`}</h5>
			<div className={css.inset}>
				<ColorPicker value={p.color} onChange={color => void change({ color })} />
			</div>
			<h5>{t`Picture`}</h5>
			<div className={css.inset}>
				<AvatarPicker
					name={p.name}
					color={p.color}
					value={p.avatar}
					onChange={avatar => void change({ avatar })}
				/>
			</div>
		</Sub>
	);
}

/** after a PIN of this profile changed: this device keeps the new token that opens it, and the
 *  hub the one its settings now ask */
async function newTokens(pin: string, which: 'open' | 'settings') {
	const p = edited();
	if (!p) return;
	const self = p.id === myProfile()?.id;
	if (which === 'open' && self) keepPin(await unlockWith(p.id, pin), p.lock === 'open');
	if (which === 'settings' || p.guard === 'same') editing.auth = await unlockWith(p.id, pin, true);
}

function OpenPinSheet() {
	const p = edited(useApp());
	const [typing, setTyping] = useState(false);
	if (!p) return null;
	const self = p.id === myProfile()?.id;
	const set = async (pin: string) => {
		if (!await change({
			pin,
			lock: p.lock ?? 'switch',
		})) return false;
		await newTokens(pin, 'open').catch(failed);
		setTyping(false);
		toast(t`PIN saved`, 1500);
		return true;
	};
	const when = async (lock: 'switch' | 'open') => {
		if (await change({ lock }) && self) keepPin(pinToken(), lock === 'open');
	};
	// removed: back to the profile, not to the boxes asking a new one
	const off = async () => {
		if (!await change({ pin: '' })) return;
		toast(t`PIN removed`, 1500);
		hub();
	};
	return (
		<Sub title={t`PIN code`}>
			{!p.lock && <p className={css.lead}>{t`Asked before this profile can be used.`}</p>}
			{!p.lock || typing
				? (
					<Group title={p.lock ? t`New PIN` : t`Choose a PIN`}>
						<PinField label={t`PIN`} done={set} autoFocus />
					</Group>
				)
				: (
					<>
						<Group title={t`Ask for the code…`}>
							<Opt
								title={t`When the profile is selected`}
								on={p.lock === 'switch'}
								onClick={() => void when('switch')}
							/>
							<Opt
								title={t`On every page load and when selected`}
								sub={t`Even on a device that was already on this profile`}
								on={p.lock === 'open'}
								onClick={() => void when('open')}
							/>
						</Group>
						<Group>
							<Row icon="lock" title={t`Change the PIN code`} onClick={() => setTyping(true)} />
							<Row icon="trash" bad title={t`Remove the PIN code`} onClick={() => void off()} />
						</Group>
					</>
				)}
		</Sub>
	);
}

function SettingsPinSheet() {
	const p = edited(useApp());
	const [typing, setTyping] = useState(false);
	if (!p) return null;
	const own = async (pin: string) => {
		if (!await change({
			guardPin: pin,
			guard: 'own',
		})) return false;
		await newTokens(pin, 'settings').catch(failed);
		setTyping(false);
		toast(t`PIN saved`, 1500);
		return true;
	};
	const same = async () => {
		// its settings now ask the PIN that opened it here
		if (await change({ guard: 'same' }) && p.id === myProfile()?.id) editing.auth = pinToken();
	};
	const none = async () => {
		if (await change({ guard: '' })) editing.auth = undefined;
	};
	return (
		<Sub title={t`PIN code for settings`}>
			<p className={css.lead}>
				{t`Asked before this profile can be changed.`}
			</p>
			<Group>
				<Opt title={t({
					message: 'None',
					context: 'PIN code for settings',
				})} on={!p.guard} onClick={() => void none()} />
				<Opt
					title={t`Reuse the access PIN code`}
					sub={p.lock ? undefined : t`Set a PIN code first`}
					disabled={!p.lock}
					on={p.guard === 'same'}
					onClick={() => void same()}
				/>
				<Opt
					title={t`Protected`}
					on={p.guard === 'own'}
					onClick={() => setTyping(true)}
				/>
			</Group>
			{typing && (
				<Group title={p.guard === 'own' ? t`New PIN for its settings` : t`Choose a PIN for its settings`}>
					<PinField label={t`PIN`} done={own} autoFocus />
				</Group>
			)}
			{p.guard === 'own' && !typing && (
				<Group>
					<Row icon="shield" title={t`Change`} onClick={() => setTyping(true)} />
				</Group>
			)}
		</Sub>
	);
}

/** an age limit nothing keeps: anyone on the profile can lift it */
function Unguarded() {
	return (
		<div className={css.warn} role="note">
			<Icon name="shield" />
			<div>
				<strong>{t`This profile’s age limit isn’t protected by a PIN code`}</strong>
				<p>{t`Add a PIN code for settings so only you can change it.`}</p>
				<Button tone="lampe" onClick={() => openSheet(<SettingsPinSheet />)}>
					{t`Add a PIN code for settings`}
				</Button>
			</div>
		</div>
	);
}

function AgeSheet() {
	const p = edited(useApp());
	const [updating, setUpdating] = useState(false);
	if (!p) return null;
	// saved, then the page behind refetches what it shows: said here, where the eyes are
	const apply = async (body: { maxAge?: number | null; unrated?: boolean }) => {
		setUpdating(true);
		if (await change(body)) {
			// its own lists and progress too, as the new limit has them
			const { lists, progress, marked } = await get('state');
			setApp({
				lists,
				progress,
				marked,
			});
			await new Promise(ok => setTimeout(ok, 50)); // the page has started fetching again
			await idle(60e3);
		}
		setUpdating(false);
	};
	const set = (maxAge: number | null) => void apply({ maxAge });
	return (
		<Sub title={t`Age limit`}>
			<p className={css.lead}>
				{t`Titles rated above it are hidden from this profile, and won’t play.`}
			</p>
			<div className={css.updating} hidden={!updating} role="status">
				<Beam />
				{t`Updating the catalog…`}
			</div>
			<Group>
				<Opt title={t`None`} on={p.maxAge == null} onClick={() => set(null)} />
				{MAX_AGES.map(a => (
					<Opt
						key={a}
						title={a ? t`Up to ${ageSays(a)}` : t`All ages only`}
						on={p.maxAge === a}
						onClick={() => set(a)}
					/>
				))}
			</Group>
			{p.maxAge != null && !p.guard && <Unguarded />}
			{p.maxAge != null && (
				<Group title={t`Titles without an age rating`}>
					<Opt title={t`Hide them`} on={!p.unrated} onClick={() => void apply({ unrated: false })} />
					<Opt title={t`Show them`} on={!!p.unrated} onClick={() => void apply({ unrated: true })} />
				</Group>
			)}
		</Sub>
	);
}

// --- a new profile ---

function NewProfile({
	pick,
	auth,
}: { pick: PickProfile; auth?: string }) {
	const [color, setColor] = useState(app().profiles.length % COLORS.length);
	const [avatar, setAvatar] = useState<string>();
	const [lang, setLang] = useState(uiLang());
	const [name, setName] = useState('');
	const input = useRef<HTMLInputElement>(null);
	const create = async () => {
		const n = name.trim();
		if (!n) return input.current!.focus();
		try {
			const list = await post('profiles', {
				name: n,
				color,
				avatar,
				lang,
				auth,
			});
			closeSheet();
			pick(list.at(-1)!.id);
		} catch (err) {
			failed(err);
		}
	};
	return (
		<Sheet title={t`New profile`}>
			<div className={css.hero}>
				<Avatar p={{
					name: name || '?',
					color,
					avatar,
				}} />
				<Field onSubmit={() => void create()}>
					<input
						ref={input}
						maxLength={24}
						value={name}
						onChange={e => setName(e.target.value)}
						placeholder={t`First name`}
						aria-label={t`Profile name`}
					/>
					<Button tone="lampe" type="submit">{t`Create`}</Button>
				</Field>
			</div>
			<h5>{t`Color`}</h5>
			<div className={css.inset}><ColorPicker value={color} onChange={setColor} /></div>
			<h5>{t`Picture`}</h5>
			<div className={css.inset}>
				<AvatarPicker name={name} color={color} value={avatar} onChange={setAvatar} />
			</div>
			<Group>
				<Setting title={t`Interface language`}>
					<InterfaceLanguage value={lang} onChange={setLang} />
				</Setting>
			</Group>
		</Sheet>
	);
}

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
		adventurers: t`Adventurers`,
		portraits: t`Portraits`,
		sketches: t`Sketches`,
		faces: t`Faces`,
		blobs: t`Blobs`,
		robots: t`Robots`,
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

