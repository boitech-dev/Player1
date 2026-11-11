import { t } from '@lingui/core/macro';
import {
	type ReactNode,
	useState,
} from 'react';

import type {
	Confirm,
	Playing,
	Release,
} from '@player1/shared/api';
import { tierTag } from '@player1/shared/langs';
import {
	canName,
	RES_LABEL,
} from '@player1/shared/release';

import {
	badge,
	names,
} from '../app/state.ts';
import { hwList } from '../lib/device.ts';
import { bytes } from '../lib/format.ts';
import { dec } from '../lib/i18n.ts';
import { Button } from '../ui/Button.tsx';
import { cx } from '../ui/cx.ts';
import { Icon } from '../ui/Icon.tsx';
import {
	ask,
	Sheet,
} from '../ui/sheet.tsx';
import {
	Badge,
	Tag,
} from '../ui/Tag.tsx';
import s from './indexer.module.scss';

// An indexer release nobody holds yet: its details before anything is downloaded. Answers the
// release's url (download it), 'now' (play what's ready instead), a library file's url, or null.

const ratio = (n: number) => dec(n >= 10 ? n.toFixed(1) : n.toFixed(2));
const tone = (n: number) => n >= 10 ? s.good : n >= 3 ? s.low : s.bad;

function What({
	tag,
	cls,
	bits,
	extra,
}: { tag: string; cls?: string; bits: (string | undefined | false)[]; extra?: ReactNode }) {
	return (
		<div className={s.what}>
			<Badge dub={cls === 'dub'} className={s.badge}>{tag}</Badge>
			{bits.filter(Boolean).map((x, i) => <span key={i}>{x}</span>)}
			{extra}
		</div>
	);
}

/** the account's ratio, and what it becomes after this download (unless it's freeleech) */
function Ratio({
	now,
	after,
	free,
}: { now: number; after: number | null; free: boolean }) {
	return (
		<span className={after != null && after < 1 && !free ? s.bad : undefined}>
			<Icon name="swap" />
			ratio {ratio(now)}{free ? ', freeleech' : ` → ${ratio(after ?? 0)}`}
		</span>
	);
}

function Facts({
	c,
	r,
	heavy,
}: { c: Release; r: Confirm; heavy: boolean }) {
	const a = r.confirm.account;
	const { indexer } = names();
	const n = c.seeders ?? 0;
	const need = c.size ?? 0;
	const after = a.up && a.down ? a.up / (a.down + (c.free ? 0 : need)) : a.after;
	const disk = a.disk;
	const size = disk != null ? bytes(disk) : '';
	return (
		<div className={s.facts}>
			<span className={tone(n)}><Icon name="users" />{t`${n} sources`}</span>
			{disk != null && (
				<span className={disk < need * 1.2 ? s.bad : undefined}>
					<Icon name="disk" />
					{t`${size} free`}
				</span>
			)}
			{a.ratio != null && <Ratio now={a.ratio} after={after} free={!!c.free} />}
			{heavy && <span className={s.low}>{t`Heavy for this device`}</span>}
			{!a.allowed && <span className={s.bad}>{t`${indexer} doesn’t let you download right now`}</span>}
		</div>
	);
}

function Ready({
	f,
	done,
}: { f: Playing; done: (v: string) => void }) {
	const [cls] = f.tier?.split(':') ?? [];
	return (
		<div className={cx(s.way, s.quick)}>
			<What
				tag={f.tier ? tierTag(f.tier) : t`Language?`}
				cls={cls}
				bits={[RES_LABEL[f.res]]}
				extra={<em><Icon name="bolt" />Real-Debrid</em>}
			/>
			<Button className={s.play} onClick={() => done('now')}><Icon name="bolt" />{t`Play`}</Button>
		</div>
	);
}

function InLibrary({
	x,
	heavy,
	done,
}: { x: Release; heavy: boolean; done: (v: string) => void }) {
	const [cls, tag] = badge(x.tag);
	return (
		<div className={cx(s.way, s.quick)}>
			<What
				tag={tag}
				cls={cls}
				bits={[RES_LABEL[x.res], !!x.size && bytes(x.size)]}
				extra={(
					<>
						<em title={x.title}><Icon name="disk" />{x.src}</em>
						{heavy && <em className={s.low}>{t`heavy`}</em>}
					</>
				)}
			/>
			<Button className={s.play} onClick={() => done(x.url)}><Icon name="bolt" />{t`Play`}</Button>
		</div>
	);
}

/** the other releases, only when asked: picking one puts it on top in place of the current one */
function Others({
	list,
	hw,
	pick,
	back,
}: { list: Release[]; hw: string[]; pick: (i: number) => void; back: () => void }) {
	return (
		<Sheet title={t`Other versions`} onBack={back}>
			<div className={s.alts}>
				{list.map((x, i) => (
					<button key={x.url} className={s.alt} onClick={() => pick(i)}>
						<Tag tag={x.tag} className={s.badge} />
						<b>{RES_LABEL[x.res] ?? ''}</b>
						<b>{bytes(x.size ?? 0)}</b>
						<span className={cx(s.n, (x.seeders ?? 0) < 3 && s.bad)}>
							<Icon name="users" />
							{x.seeders}
							{!canName(x.title, x.res, hw) ? ', ' + t`heavy` : ''}
						</span>
						<small>{x.title}</small>
					</button>
				))}
			</div>
		</Sheet>
	);
}

function waitFor(c: Release) {
	// a seedbox pulls ~80 MB/s from a healthy swarm
	if ((c.seeders ?? 0) < 5) return t`slow`;
	const secs = (c.size ?? 0) / 80e6;
	return `${secs < 50 ? '' : '~'}${Math.max(1, Math.ceil(secs / 60))} min`;
}

function Offer({
	r,
	hw,
	done,
}: { r: Confirm; hw: string[]; done: (v: string) => void }) {
	const [c, setC] = useState<Release>(r.confirm);
	const [others, setOthers] = useState(r.confirm.others);
	const [more, setMore] = useState(false);
	const { indexer } = names();
	const heavy = (x: Release) => !canName(x.title, x.res, hw);
	const allowed = r.confirm.account.allowed;
	if (more) return (
		<Others
			list={others}
			hw={hw}
			back={() => setMore(false)}
			pick={i => {
				const next = [...others];
				next[i] = c;
				setC(others[i]!);
				setOthers(next);
				setMore(false);
			}}
		/>
	);
	const [cls, tag] = badge(c.tag);
	const n = others.length;
	const wait = waitFor(c);
	return (
		<Sheet title={t`Available on ${indexer}`}>
			<div className={s.way}>
				<What tag={tag} cls={cls} bits={[RES_LABEL[c.res], bytes(c.size ?? 0)]} />
				<Facts c={c} r={r} heavy={heavy(c)} />
				<p className={s.rel}>{c.title}</p>
				<Button tone="lampe" disabled={!allowed} onClick={() => done(c.url)}>
					<Icon name="clock" />
					{t`Download, ${wait}`}
				</Button>
				{n > 0 && (
					<Button tone="ghost" className={s.more} onClick={() => setMore(true)}>
						{n > 1 ? t`${n} other versions` : t`${n} other version`}
					</Button>
				)}
			</div>
			{r.fallback && <Ready f={r.fallback} done={done} />}
			{r.confirm.library.map(x => <InLibrary key={x.url} x={x} heavy={heavy(x)} done={done} />)}
		</Sheet>
	);
}

/** asks before an indexer download; the player waits for the answer */
export async function confirmSheet(r: Confirm) {
	const hw = (await hwList()).split(',');
	return ask<string>(done => <Offer r={r} hw={hw} done={done} />);
}
