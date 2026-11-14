import { i18n } from '@lingui/core';
import { t } from '@lingui/core/macro';
import {
	type ReactNode,
	useEffect,
	useRef,
	useState,
} from 'react';

import type {
	DiskInfo,
	SettingsReply,
	StorageReply,
	StorageUse,
	UpdateInfo,
} from '@player1/shared/api';

import {
	get,
	post,
} from '../lib/api.ts';
import {
	bytes,
	day,
	moment,
} from '../lib/format.ts';
import {
	Button,
	ButtonLink,
} from '../ui/Button.tsx';
import { Icon } from '../ui/Icon.tsx';
import {
	Choice,
	Seg,
} from '../ui/Seg.tsx';
import { toast } from '../ui/toast.tsx';
import css from './Settings.module.scss';
import form from './Setup.module.scss';
import {
	type Form,
	Service,
	SVC,
	type SvcId,
	useForm,
	useSave,
	useSettings,
} from './Setup.tsx';

// #/settings: everything this server is set up with, on one board. Four groups; in each, one line
// per thing, with a lamp for how it is doing and a few words saying so. A line opens on its form.
// Save only shows up once something was changed.

/** a line's lamp: off (not set up), warming up (being checked), lit, or red */
type Lamp = '' | 'wait' | 'ok' | 'bad';

interface Line {
	open: boolean;
	onToggle: () => void;
}

function Row({
	name,
	lamp,
	says,
	open,
	onToggle,
	children,
}: Line & { name: string; lamp: Lamp; says: string; children: ReactNode }) {
	return (
		<div className={css.row} data-open={open || undefined}>
			<button type="button" className={css.head} aria-expanded={open} onClick={onToggle}>
				<span className={css.lamp} data-st={lamp || undefined} />
				<span className={css.what}>
					<strong>{name}</strong>
					<span className={lamp === 'bad' ? css.bad : undefined} aria-live="polite">{says}</span>
				</span>
				<Icon name="back" />
			</button>
			{open && <div className={css.body}>{children}</div>}
		</div>
	);
}

function Group({
	title,
	children,
}: { title: string; children: ReactNode }) {
	return (
		<section className={css.group}>
			<h2>{title}</h2>
			{children}
		</section>
	);
}

// --- a service: its check's answer on the line, its form inside ---

function ServiceRow({
	id,
	form: f,
	name,
	...line
}: Line & { id: SvcId; form: Form; name?: string }) {
	const c = SVC.find(x => x.id === id)!;
	const s = f.checks[id];
	const idle = f.filled(c) ? f.vals[c.fields[0]!.k] ?? '' : t`Not set up`;
	return (
		<Row name={name ?? i18n._(c.name)} lamp={s?.st ?? ''} says={s?.text || idle} {...line}>
			<Service c={c} form={f} />
		</Row>
	);
}

// --- updates: run.mjs follows the master branch of the code's git repository, and builds the
// Android TV app ---

const at = (n?: number) => n ? moment(n) : '';

function updateSays(u: UpdateInfo): [Lamp, string] {
	if (!u.supervised) return ['', t`No automatic updates: the server wasn’t started with run.mjs.`];
	const error = u.error ?? '';
	switch (u.status) {
		case 'latest': {
			const when = at(u.checked);
			return ['ok', t`Up to date, checked on ${when}.`];
		}
		case 'building': return ['wait', t`New version being prepared…`];
		case 'trial': return [
			'wait',
			t`The new version is running. If it fails in its first 2 minutes, the previous one comes back.`,
		];
		case 'updated': return ['ok', t`The new version is running.`];
		case 'failed': return [
			'bad',
			t`The new version didn’t pass its tests, so nothing changed. ${error}`,
		];
		case 'rolled-back': return [
			'bad',
			t`The new version didn’t start, so the previous one is back. The next version will be tried when it comes out.`,
		];
		case 'unreachable': return [
			'bad',
			t`This server can’t reach the place updates come from (${error}). If it’s a private git repository, the server needs its own access key.`,
		];
		case 'no-remote': return [
			'',
			t`Updates aren’t set up: this installation isn’t linked to a git repository.`,
		];
		case 'local-changes': return [
			'bad',
			t`Updates are paused: Player1’s files were changed by hand on this server.`,
		];
		case 'diverged': return [
			'bad',
			t`Updates are paused: this installation has changes of its own that the official version doesn’t have.`,
		];
		case 'testing': return ['wait', t`A test version is running. The next release replaces it.`];
		default: return ['', t`Not checked yet.`];
	}
}

function versionSays(u: UpdateInfo) {
	const commit = u.commit ?? '?';
	const date = u.date ? day(u.date) : '';
	const version = u.version ?? '';
	if (version && u.release) return t`Version ${version}, from ${date}.`;
	if (version) return t`Version ${version} and later changes (${commit}, ${date}).`;
	return date ? t`Version ${commit} from ${date}.` : t`Version ${commit}.`;
}

/** how updates and the TV app's build stand; asking for one, then looking again a little later */
function useUpdate(first: UpdateInfo) {
	const [u, setU] = useState(first);
	const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
	useEffect(() => () => clearTimeout(timer.current), []);
	const run = async (what: 'update' | 'tv') => {
		try {
			setU(await post('settings/update', { what }));
		} catch (err) {
			return toast((err as Error).message);
		}
		toast(what === 'tv' ? t`Building the TV app…` : t`Checking for updates…`);
		clearTimeout(timer.current);
		timer.current = setTimeout(() => {
			get('settings').then(r => setU(r.update), () => undefined);
		}, 8000);
	};
	return {
		u,
		run,
	};
}

type Update = ReturnType<typeof useUpdate>;
type Auto = 'on' | 'off';

function UpdateRow({
	u,
	run,
	locked,
	auto,
	setAuto,
	...line
}: Line & Update & { locked: boolean; auto: Auto; setAuto: (a: Auto) => void }) {
	const [lamp, says] = updateSays(u);
	const how = t`Each new version is tested before it replaces this one. If it doesn’t start, the previous one comes back.`;
	const choice = (k: Auto, label: string) => (
		<Choice pressed={auto === k} disabled={locked} onClick={() => setAuto(k)}>
			{label}
		</Choice>
	);
	return (
		<Row name={t`Updates`} lamp={lamp} says={says} {...line}>
			<div className={form.svc}>
				<p>
					{versionSays(u)}
					{' '}
					{how}
				</p>
				<Seg label={t`Automatic updates`} className={form.seg}>
					{choice('on', t`Automatic`)}
					{choice('off', t`Off`)}
				</Seg>
				<Button onClick={() => void run('update')}>{t`Check for updates`}</Button>
			</div>
		</Row>
	);
}

// --- the TV apps ---

function tvSays(u: UpdateInfo): [Lamp, string] {
	const error = u.tvError ?? '';
	const version = u.tvVersion ?? 0;
	if (u.tv === 'building') return ['wait', t`Building…`];
	if (u.tv === 'failed') return ['bad', t`The last build failed. ${error}`];
	return version ? ['ok', t`Version ${version}`] : ['', t`Not built yet`];
}

/** the Android TV app: the TV downloads it from this server, then it updates itself */
function AndroidRow({
	u,
	run,
	site,
	...line
}: Line & Update & { site: string }) {
	const [lamp, says] = tvSays(u);
	const how = t`On the TV, open this address in its browser and install the file it downloads. The app updates itself afterwards.`;
	return (
		<Row name={t`Android TV app`} lamp={lamp} says={says} {...line}>
			<div className={form.svc}>
				<p>{how}</p>
				<p className={form.addr}>{`${site}/tv`}</p>
				{!!u.tvVersion && <ButtonLink href="/player1.apk" download>{t`Download the app`}</ButtonLink>}
				<Button onClick={() => void run('tv')}>{t`Rebuild the TV app`}</Button>
			</div>
		</Row>
	);
}

/** the LG TV app: installed from here on a TV in Developer Mode; a TV with Homebrew Channel takes
 *  it from this server by itself; the package is there for any other tool */
function LgRow({
	site,
	...line
}: Line & { site: string }) {
	const [host, setHost] = useState('');
	const [code, setCode] = useState('');
	const [s, setS] = useState<{ st: Lamp; text: string }>();
	const how = t`On the TV, open the Developer Mode app, turn on Dev Mode Status and Key Server, then type here the TV’s address and the passphrase the app shows.`;
	const homebrew = t`A TV with Homebrew Channel installs it by itself: in Homebrew Channel’s settings, add this repository, then pick Player1 in the list.`;
	const install = async () => {
		setS({
			st: 'wait',
			text: t`Installing on the TV…`,
		});
		try {
			await post('settings/lg', {
				host,
				code,
			});
			setS({
				st: 'ok',
				text: t`Installed: Player1 is among the TV’s apps.`,
			});
		} catch (err) {
			setS({
				st: 'bad',
				text: (err as Error).message,
			});
		}
	};
	return (
		<Row
			name={t`LG TV app`}
			lamp={s?.st ?? ''}
			says={s?.text ?? t`Install it on a TV from here`}
			{...line}
		>
			<div className={form.svc}>
				<p>{how}</p>
				<label>
					{t`The TV’s address`}
					<input
						value={host}
						placeholder="192.168.1.42"
						inputMode="decimal"
						autoComplete="off"
						spellCheck={false}
						onChange={e => setHost(e.target.value)}
					/>
				</label>
				<label>
					{t`Passphrase`}
					<input
						value={code}
						placeholder="A1B2C3"
						autoComplete="off"
						autoCapitalize="characters"
						spellCheck={false}
						onChange={e => setCode(e.target.value)}
					/>
				</label>
				<Button
					disabled={!host.trim() || !code.trim() || s?.st === 'wait'}
					onClick={() => void install()}
				>
					{t`Install on the TV`}
				</Button>
				<p className={form.more}>{homebrew}</p>
				<p className={form.addr}>{`${site}/webos.json`}</p>
				<ButtonLink href="/player1.ipk" download>{t`Download the package`}</ButtonLink>
			</div>
		</Row>
	);
}

// --- under the board: the disks, and what this server runs ---

const USE: Record<StorageUse, () => string> = {
	trailers: () => t`Trailers`,
	samples: () => t`Device test clips`,
	tools: () => t`Tools (Node, Android build, yt-dlp)`,
	builds: () => t`Server versions (current and previous)`,
	tv: () => t`TV apps`,
	household: () => t`Household data`,
	downloads: () => t`Downloads, in the library`,
	other: () => t`Other`,
};

const diskName = (d: DiskInfo) => {
	if (d.holds.length > 1) return t`This server’s disk, with the library`;
	return d.holds[0] === 'library' ? t`Library` : t`This server’s disk`;
};

/** a disk: Player1's share, everything else, and the room left, on one bar */
function Disk({ d }: { d: DiskInfo }) {
	const pct = (n: number) => `${d.size ? n / d.size * 100 : 0}%`;
	const free = bytes(d.free);
	const size = bytes(d.size);
	const mine = bytes(d.player1);
	const low = d.free < d.size * 0.1;
	return (
		<div className={css.disk}>
			<div className={css.diskHead}>
				<strong>{diskName(d)}</strong>
				<span className={css.path}>{d.path}</span>
			</div>
			<div className={css.bar} data-low={low || undefined}>
				<span
					className={css.mine}
					style={{
						width: pct(d.player1),
						minWidth: d.player1 ? 3 : 0,
					}}
				/>
				<span style={{ width: pct(Math.max(0, d.size - d.free - d.player1)) }} />
			</div>
			<p className={low ? css.bad : undefined}>
				{t`${free} free of ${size}, Player1 takes ${mine}.`}
			</p>
		</div>
	);
}

function Storage() {
	const [s, setS] = useState<StorageReply>();
	const [failed, setFailed] = useState('');
	useEffect(() => {
		get('settings/storage').then(setS, (err: unknown) => setFailed((err as Error).message));
	}, []);
	if (!s) return <p className={css.quiet}>{failed || t`Measuring…`}</p>;
	const top = s.used[0]?.bytes ?? 1;
	return (
		<>
			{s.disks.map(d => <Disk key={d.path} d={d} />)}
			<ul className={css.used}>
				{s.used.map(u => (
					<li key={u.what}>
						<span>{USE[u.what]()}</span>
						<span className={css.size}>{bytes(u.bytes)}</span>
						<span className={css.share} style={{ width: `${u.bytes / top * 100}%` }} />
					</li>
				))}
			</ul>
		</>
	);
}

function Version({ u }: { u: UpdateInfo }) {
	const tv = u.tvVersion ?? 0;
	return (
		<>
			<p className={css.version}>{u.version ?? u.commit ?? '?'}</p>
			<p>{versionSays(u)}</p>
			{!!tv && <p className={css.quiet}>{t`Android TV app: version ${tv}.`}</p>}
		</>
	);
}

// --- the page ---

/** under the title: how the services are doing, once every check has answered */
function healthSays(f: Form) {
	const settled = SVC.every(c => f.checks[c.id] && f.checks[c.id]?.st !== 'wait');
	if (!settled) return t`What this server is set up with, for the whole household.`;
	const list = SVC
		.filter(c => f.checks[c.id]?.ok === false)
		.map(c => i18n._(c.name))
		.join(', ');
	return list ? t`Not connected: ${list}.` : t`Everything is connected.`;
}

function Settings({ view }: { view: SettingsReply }) {
	const f = useForm(view);
	const [message, setMessage] = useState('');
	const { busy, save } = useSave(setMessage);
	const update = useUpdate(view.update);
	const updates = view.values.UPDATES;
	const saved: Auto = updates.value === 'off' ? 'off' : 'on';
	const [auto, setAuto] = useState(saved);
	const [opened, setOpened] = useState('');
	const line = (id: string): Line => ({
		open: opened === id,
		onToggle: () => setOpened(opened === id ? '' : id),
	});
	const service = (id: SvcId, name?: string) => (
		<ServiceRow id={id} form={f} name={name} {...line(id)} />
	);
	const site = (view.values.PUBLIC_URL.value || view.url).replace(/\/$/, '');
	const rd = !!f.checks.rd?.ok;
	const submit = () => void save({
		...f.toSave(),
		...updates.env ? {} : { UPDATES: auto },
	});
	// the one place that says why Save is off; the Real-Debrid line itself says what is wrong
	const unsaved = rd
		? t`Not saved yet. Saving restarts the server.`
		: t`Real-Debrid has to work before anything can be saved.`;

	return (
		<section className={css.page}>
			<h1>{t`Settings`}</h1>
			<p>{healthSays(f)}</p>
			<div className={css.board}>
				<Group title={t`Films and series`}>
					{service('rd')}
					{service('addon')}
					{service('tmdb')}
				</Group>
				<Group title={t`Library and downloads`}>
					{service('jellyfin')}
					{service('indexer')}
					{service('qbit')}
				</Group>
				<Group title={t`TV apps`}>
					<AndroidRow {...update} site={site} {...line('android')} />
					<LgRow site={site} {...line('lg')} />
				</Group>
				<Group title={t`This server`}>
					{service('site', t`Address`)}
					<UpdateRow
						{...update}
						locked={updates.env}
						auto={auto}
						setAuto={setAuto}
						{...line('updates')}
					/>
				</Group>
			</div>
			<div className={css.below}>
				<Group title={t`Disk space`}>
					<Storage />
				</Group>
				<Group title={t`Version`}>
					<Version u={update.u} />
				</Group>
			</div>
			{(busy || f.dirty || auto !== saved) && (
				<div className={css.save}>
					<p id="goMsg">{message || unsaved}</p>
					<Button tone="lampe" id="saveBtn" disabled={busy || !rd} onClick={submit}>
						{t`Save`}
					</Button>
				</div>
			)}
		</section>
	);
}

/** #/settings: this server's services, apps and updates, for the whole household */
export function SettingsPage() {
	const view = useSettings();
	return view ? <Settings view={view} /> : null;
}
