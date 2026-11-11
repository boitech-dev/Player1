import {
	i18n,
	type MessageDescriptor,
} from '@lingui/core';
import {
	msg,
	t,
} from '@lingui/core/macro';
import {
	useCallback,
	useEffect,
	useRef,
	useState,
} from 'react';

import type {
	CheckResult,
	ServiceId,
	SettingKey,
	SettingsReply,
	SettingView,
} from '@player1/shared/api';

import {
	alive,
	get,
	post,
} from '../lib/api.ts';
import { day } from '../lib/format.ts';
import { setSetupToken } from '../lib/store.ts';
import { Button } from '../ui/Button.tsx';
import { cx } from '../ui/cx.ts';
import type { IconName } from '../ui/Icon.tsx';
import { Stack } from '../ui/Stack.tsx';
import { toast } from '../ui/toast.tsx';
import {
	StepTitle,
	Wizard,
} from '../ui/Wizard.tsx';
import pair from './Pair.module.scss';
import css from './Setup.module.scss';

// The services this server uses, each checked live against the real one, and the first-run setup,
// which shows one of them per screen. The settings page (Settings.tsx) lays them out as a board.

export type SvcId = ServiceId | 'site';

interface Field {
	k: SettingKey;
	label: MessageDescriptor;
	/** shown in the empty field: an example (as is), or what to do (translated) */
	ph: string | MessageDescriptor;
}

export interface Svc {
	id: SvcId;
	/** its small picture on the wizard's card */
	icon: IconName;
	name: MessageDescriptor;
	about: MessageDescriptor;
	/** required: no Skip */
	need?: boolean;
	link?: { url: string; label: MessageDescriptor };
	fields: Field[];
	/** a button that fills in a known service, and opens its page for the key */
	preset?: { label: MessageDescriptor; values: Vals; url: string };
}

type Vals = Partial<Record<SettingKey, string>>;

const PASTE = msg`Paste your key here`;

const field = (k: SettingKey, label: MessageDescriptor, ph: Field['ph']): Field => ({
	k,
	label,
	ph,
});

export const SVC: Svc[] = [
	{
		id: 'rd',
		icon: 'bolt',
		name: msg`Real-Debrid`,
		need: true,
		about: msg`Finds and plays movies and series.`,
		link: {
			url: 'https://real-debrid.com/apitoken',
			label: msg`Find your key here`,
		},
		fields: [field('RD_TOKEN', msg`API key`, PASTE)],
	},
	{
		id: 'tmdb',
		icon: 'film',
		name: msg`TMDB`,
		about: msg`Adds posters, summaries, categories and trailers. Without it, the catalog only shows popular titles.`,
		link: {
			url: 'https://www.themoviedb.org/settings/api',
			label: msg`Get a free TMDB key`,
		},
		fields: [field('TMDB_KEY', msg`API key or read access token`, PASTE)],
	},
	{
		id: 'addon',
		icon: 'layers',
		name: msg`Sources`,
		about: msg`Where Player1 finds what Real-Debrid can play. Leave empty for Torrentio, or paste the address of another Stremio addon.`,
		fields: [field('STREAM_ADDON', msg`Addon address`, 'https://torrentio.strem.fun/…')],
	},
	{
		id: 'indexer',
		icon: 'search',
		name: msg`Torrent site`,
		about: msg`Where to look when Real-Debrid doesn’t have a title, French versions for example. Paste its Torznab address (C411, Prowlarr and Jackett give you one).`,
		fields: [
			field('TORZNAB_URL', msg`The site’s Torznab address`, 'https://c411.org/api/torznab'),
			field('TORZNAB_KEY', msg`API key`, PASTE),
		],
		preset: {
			label: msg`Use C411`,
			values: { TORZNAB_URL: 'https://c411.org/api/torznab' },
			url: 'https://c411.org/user/integrations',
		},
	},
	{
		id: 'qbit',
		icon: 'dl',
		name: msg`qBittorrent`,
		about: msg`Downloads what the torrent site finds. What it already has plays right away. On a seedbox or a computer at home.`,
		fields: [
			field('QBIT_URL', msg`qBittorrent’s address`, 'http://192.168.1.20:8080'),
			field('QBIT_USER', msg`Username`, 'admin'),
			field('QBIT_PASS', msg`Password`, msg`The one you log in to qBittorrent with`),
			field(
				'QBIT_FILES',
				msg`Its download folder, as seen from this server (empty with Whatbox)`,
				'/srv/downloads',
			),
		],
	},
	{
		id: 'jellyfin',
		icon: 'books',
		name: msg`Jellyfin`,
		about: msg`Your own film library. What’s already in it plays first, and you can download any film into it to keep.`,
		fields: [
			field('MEDIA_DIR', msg`Library folder on this server`, '/srv/media'),
			field('JELLYFIN_URL', msg`Jellyfin address`, 'http://192.168.1.10:8096'),
			field('JELLYFIN_KEY', msg`API key (in Jellyfin: Dashboard, then API Keys)`, PASTE),
		],
	},
	{
		id: 'site',
		icon: 'globe',
		name: msg`This server`,
		need: true,
		about: msg`The address you type to open Player1 from your devices. The TV app connects to it.`,
		fields: [field('PUBLIC_URL', msg`This server’s address`, 'https://player.example.com')],
	},
];

const SECRET = /TOKEN|KEY|PASS/;
const FIELDS = SVC.flatMap(c => c.fields.map(f => f.k));
const wait = (ms: number) => new Promise(ok => setTimeout(ok, ms));

// --- what a check result means, in words ---

const str = (x: string | boolean | undefined) => typeof x === 'string' ? x : '';

function saidOk(id: SvcId, r: CheckResult) {
	const i = r.info ?? {};
	const user = str(i.user);
	const name = str(i.name);
	const version = str(i.version);
	const until = i.until ? day(str(i.until)) : '';
	switch (id) {
		case 'rd': return t`Connected as ${user}, premium until ${until}`;
		case 'tmdb': return t`Key accepted`;
		case 'addon': return t`Connected to ${name}`;
		case 'indexer': return name ? t`Connected to ${name}` : t`Connected to the torrent site`;
		case 'qbit': return i.files === 'whatbox'
			? t`Connected to qBittorrent ${version}, files read from Whatbox`
			: t`Connected to qBittorrent ${version}`;
		case 'jellyfin':
			if (!r.info) return t`Folder found`;
			return i.writable
				? t`Connected to ${name} (Jellyfin ${version})`
				: t`Connected. No downloads: the folder is read-only.`;
		default: return t`OK`;
	}
}

/** an answer with an error code, else the service's own words */
function otherErr(err: string) {
	const code = /^HTTP (\d+)$/.exec(err)?.[1];
	return code ? t`It answered with an error (code ${code}).` : err;
}

function saidErr(r: CheckResult) {
	const user = str(r.info?.user);
	switch (r.err) {
		case 'refused': return t`Refused. Check the key or the password.`;
		case 'unreachable': return t`Can’t reach this address. Check it for typos.`;
		case 'timeout': return t`No answer after 8 seconds. Is it running?`;
		case 'not-premium': return t`${user} isn’t a premium account. Real-Debrid needs one.`;
		case 'no-streams': return t`This addon can’t list sources. Use another one.`;
		case 'not-torznab': return t`Not a Torznab address. Copy it from the site’s settings.`;
		case 'files-missing': return t`Add its download folder`;
		case 'files-not-found':
		case 'media-not-found': return t`This folder doesn’t exist on this server`;
		case 'empty': return '';
		default: return otherErr(r.err ?? '');
	}
}

const said = (id: SvcId, r: CheckResult) => r.ok ? saidOk(id, r) : saidErr(r);

// --- this server's address, tried from this device: it is devices that have to open it ---

async function checkSite(address: string): Promise<Status> {
	const bad = (text: string): Status => ({
		st: 'bad',
		text,
		ok: false,
	});
	let url: URL;
	try {
		url = new URL(address);
	} catch {
		return bad(t`An address starts with http:// or https://`);
	}
	const here = url.origin === location.origin;
	// a page opened in https isn't allowed to ask a plain http address anything
	if (!here && location.protocol === 'https:' && url.protocol === 'http:') return {
		st: '',
		text: '',
		ok: true,
	};
	const stop = new AbortController();
	const late = setTimeout(() => stop.abort(), 8000);
	try {
		const r = here || await fetch(`${url.origin}/api/setup`, { signal: stop.signal });
		if (r !== true && !('needed' in await r.json())) throw new SyntaxError();
	} catch (err) {
		if (err instanceof SyntaxError) return bad(t`Something else answers at this address, not Player1.`);
		return bad(url.hostname.endsWith('.ts.net')
			? t`Can’t open this address. Install Tailscale on this device and sign in.`
			: t`This device can’t open this address.`);
	} finally {
		clearTimeout(late);
	}
	return {
		st: 'ok',
		text: t`Player1 answers at this address`,
		ok: true,
	};
}

// --- the form: every service's fields and live checks ---

export interface Status {
	st: '' | 'wait' | 'ok' | 'bad';
	text: string;
	ok?: boolean;
	/** the last answer, kept in place while a new check runs */
	last?: string;
}

const initialVals = (r: SettingsReply): Vals => Object.fromEntries(FIELDS.map(k => [
	k,
	SECRET.test(k) ? '' : r.values[k].value || (k === 'PUBLIC_URL' ? r.url : ''),
]));
const pick = (c: Svc, v: Vals): Vals => Object.fromEntries(c.fields.map(f => [
	f.k,
	(v[f.k] ?? '').trim(),
]));
const filled = (c: Svc, v: Vals, view: SettingsReply) =>
	c.fields.some(f => (v[f.k] ?? '').trim() || view.values[f.k].set);

export function useForm(view: SettingsReply) {
	const [first] = useState(() => initialVals(view));
	const [vals, setVals] = useState(first);
	const [checks, setChecks] = useState<Partial<Record<SvcId, Status>>>({});
	const latest = useRef(vals);
	const timers = useRef(new Map<SvcId, ReturnType<typeof setTimeout>>());
	const runs = useRef(new Map<SvcId, number>());

	// a service's status; a newer check (or Skip) makes an older one's answer stale
	const stamp = useCallback((id: SvcId) => {
		const n = (runs.current.get(id) ?? 0) + 1;
		runs.current.set(id, n);
		clearTimeout(timers.current.get(id));
		return (s: (was?: Status) => Status) => {
			if (runs.current.get(id) === n) setChecks(x => ({
				...x,
				[id]: s(x[id]),
			}));
		};
	}, []);

	const test = useCallback(async (c: Svc) => {
		const set = stamp(c.id);
		const values = pick(c, latest.current);
		const id = c.id;
		if (!filled(c, values, view)) return set(() => ({
			st: '',
			text: '',
			ok: !c.need,
		}));
		set(was => ({
			st: 'wait',
			text: t`Checking…`,
			ok: false,
			last: was?.st === 'wait' ? was.last : was?.text,
		}));
		if (id === 'site') {
			const s = await checkSite(values.PUBLIC_URL ?? '');
			return set(() => s);
		}
		const r = await post('settings/check', {
			name: id,
			values,
		}).catch((err: Error): CheckResult => ({
			ok: false,
			err: err.message,
		}));
		set(() => ({
			st: r.ok ? 'ok' : 'bad',
			text: said(id, r),
			ok: r.ok,
		}));
	}, [stamp, view]);

	useEffect(() => {
		const all = timers.current;
		SVC.forEach(c => void test(c));
		return () => all.forEach(clearTimeout);
	}, [test]);

	const fill = (patch: Vals) => {
		latest.current = {
			...latest.current,
			...patch,
		};
		setVals(latest.current);
	};

	return {
		view,
		vals,
		checks,
		fill,
		/** typed: shown as being checked at once, checked 700 ms after the last key */
		change(c: Svc, k: SettingKey, v: string) {
			fill({ [k]: v });
			stamp(c.id)(was => ({
				st: 'wait',
				text: t`Checking…`,
				ok: false,
				last: was?.st === 'wait' ? was.last : was?.text,
			}));
			clearTimeout(timers.current.get(c.id));
			timers.current.set(c.id, setTimeout(() => void test(c), 700));
		},
		/** skipped: nothing of it gets saved */
		skip(c: Svc) {
			fill(Object.fromEntries(c.fields.filter(f => !view.values[f.k].env).map(f => [f.k, ''])));
			stamp(c.id)(() => ({
				st: '',
				text: '',
				ok: true,
			}));
		},
		filled: (c: Svc) => filled(c, vals, view),
		/** something typed that isn't saved yet */
		dirty: FIELDS.some(k => !view.values[k].env && (vals[k] ?? '').trim() !== first[k]),
		/** what Save sends: everything not set in .env, secrets only when typed */
		toSave: (): Vals => Object.fromEntries(FIELDS
			.filter(k => !view.values[k].env)
			.map(k => [k, (latest.current[k] ?? '').trim()] as const)
			.filter(([k, v]) => !SECRET.test(k) || v)),
	};
}

export type Form = ReturnType<typeof useForm>;

/** save, then wait for the server to come back (up to 40 s) and start again */
export function useSave(say: (m: string) => void) {
	const [busy, setBusy] = useState(false);
	const save = async (values: Vals) => {
		setBusy(true);
		say(t`Saving, then restarting the server…`);
		try {
			await post('settings', { values });
		} catch (err) {
			setBusy(false);
			say((err as Error).message);
			return;
		}
		setSetupToken(null);
		for (let i = 0; i < 40; i++) {
			await wait(1000);
			if (await alive()) break;
		}
		location.replace('/');
	};
	return {
		busy,
		save,
	};
}

export function useSettings() {
	const [view, setView] = useState<SettingsReply | null>(null);
	useEffect(() => {
		get('settings').then(setView, (err: Error) => toast(err.message));
	}, []);
	return view;
}

// --- one service ---

/** keys aren't passwords for this site: keep password managers out */
function FieldInput({
	f,
	x,
	value,
	onChange,
}: { f: Field; x: SettingView; value: string; onChange: (v: string) => void }) {
	const secret = SECRET.test(f.k);
	const hint = x.hint;
	let placeholder = typeof f.ph === 'string' ? f.ph : i18n._(f.ph);
	if (x.env) placeholder = t`Set in the .env file`;
	else if (secret && x.set) placeholder = hint ? t`Saved, ends with ${hint}` : t`Saved`;
	return (
		<label>
			{i18n._(f.label)}
			<input
				data-k={f.k}
				data-secret={secret || undefined}
				className={f.k === 'QBIT_PASS' ? css.masked : undefined}
				autoComplete="off"
				data-1p-ignore=""
				data-lpignore="true"
				data-bwignore=""
				data-form-type="other"
				spellCheck={false}
				value={value}
				placeholder={placeholder}
				disabled={x.env}
				onChange={e => onChange(e.target.value)}
			/>
		</label>
	);
}

/** a check's answer; "Checking…" takes the place of the last one, which keeps its room */
function StatusLine({ s }: { s?: Status }) {
	const wait = s?.st === 'wait';
	return (
		<p className={cx(css.st, (s?.st === 'ok' || s?.st === 'bad') && css[s.st])} aria-live="polite">
			<Stack show={wait ? 0 : 1}>
				{t`Checking…`}
				{wait ? s.last : s?.text}
			</Stack>
		</p>
	);
}

/** a service: what it is, its fields, its shortcut. The first run adds a title and the check's answer;
 *  the settings page shows those on the service's own line. */
export function Service({
	c,
	form,
	visual,
}: { c: Svc; form: Form; visual?: boolean }) {
	const box = useRef<HTMLDivElement>(null);
	const applyPreset = (p: NonNullable<Svc['preset']>) => {
		form.fill(p.values);
		window.open(p.url, '_blank', 'noopener');
		box.current?.querySelector<HTMLInputElement>('[data-secret]')?.focus();
	};
	return (
		<div className={css.svc} data-svc={c.id} ref={box}>
			{visual && <StepTitle icon={c.icon} tag={!c.need && t`optional`}>{i18n._(c.name)}</StepTitle>}
			<p>
				{i18n._(c.about)}
				{c.link && (
					<>
						{' '}
						<a href={c.link.url} target="_blank" rel="noopener">{i18n._(c.link.label)}</a>
					</>
				)}
				{c.id === 'site' && form.view.values.PUBLIC_URL.env && (
					' ' + t`It was chosen during installation: run the installer again to change it.`
				)}
			</p>
			{c.fields.map(f => (
				<FieldInput
					key={f.k}
					f={f}
					x={form.view.values[f.k]}
					value={form.vals[f.k] ?? ''}
					onChange={v => form.change(c, f.k, v)}
				/>
			))}
			{c.preset && (
				<Button data-preset={c.id} onClick={() => applyPreset(c.preset!)}>
					{i18n._(c.preset.label)}
				</Button>
			)}
			{visual && <StatusLine s={form.checks[c.id]} />}
		</div>
	);
}

// --- first run: one service per screen; Next once it answers, Skip for the optional ones ---

function SetupSteps({ view }: { view: SettingsReply }) {
	const form = useForm(view);
	const { busy, save } = useSave(toast);
	const [at, setAt] = useState(0);
	const c = SVC[at]!;
	const last = at === SVC.length - 1;
	const ready = c.id === 'site'
		? !!form.vals.PUBLIC_URL?.trim()
		: !!form.checks[c.id]?.ok && form.filled(c);
	const st = form.checks[c.id]?.st;

	const next = () => {
		if (last) void save(form.toSave());
		else setAt(at + 1);
	};
	const skip = () => {
		form.skip(c);
		setAt(at + 1);
	};

	return (
		<Wizard
			className={css.steps}
			at={at}
			marks={SVC.map(x => form.checks[x.id]?.st || undefined)}
			hello={(
				<>
					<h1>{t`Welcome`}</h1>
					<p>{t`Initial setup`}</p>
				</>
			)}
			st={st}
			step={c.id}
			onBack={at ? () => setAt(at - 1) : undefined}
			onSkip={c.need ? undefined : skip}
			onNext={next}
			blocked={busy || !ready}
			checking={st === 'wait'}
			last={last}
		>
			<Service c={c} form={form} visual />
		</Wizard>
	);
}

/** the first start, opened with the installer's one-time link */
export function SetupWizard() {
	const view = useSettings();
	return view ? <SetupSteps view={view} /> : null;
}

/** a first start opened without the one-time link */
export function SetupLocked() {
	const how = t`To set up Player1, open the link the installer showed at the end. It’s also in the server’s log, on the line that starts with “setup”.`;
	return (
		<section className={pair.pair}>
			<small>Player1</small>
			<div className={pair.code} style={{ fontSize: 'clamp(56px,9vw,112px)' }}>{t`Setup needed`}</div>
			<p>{how}</p>
		</section>
	);
}
