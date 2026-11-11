import { t } from '@lingui/core/macro';
import {
	useEffect,
	useState,
} from 'react';

import type {
	Download,
	Downloads,
	Playing,
	PlayRequest,
	Stream,
} from '@player1/shared/api';
import { tierTag } from '@player1/shared/langs';
import { RES_LABEL } from '@player1/shared/release';

import {
	badge,
	names,
} from '../app/state.ts';
import {
	get,
	post,
} from '../lib/api.ts';
import { bytes } from '../lib/format.ts';
import { dec } from '../lib/i18n.ts';
import { cx } from '../ui/cx.ts';
import { Icon } from '../ui/Icon.tsx';
import {
	openSheet,
	Opt,
	Sheet,
} from '../ui/sheet.tsx';
import {
	Badge,
	Tag,
} from '../ui/Tag.tsx';
import tx from '../ui/text.module.scss';
import { toast } from '../ui/toast.tsx';
import s from './download.module.scss';

// "Download into Jellyfin": any version of a film or episode (Real-Debrid, indexer, qBittorrent),
// copied as it is into the Player1 libraries on the Jellyfin drive. Next time it plays from there.

const ACTIVE = /queued|whatbox|copying/;

/** adds a version to the server's downloads */
interface Version {
	url: string;
	label: string;
	size?: number;
}

export async function download(req: PlayRequest, src: Version) {
	try {
		const r = await post('download', {
			type: req.type,
			imdb: req.imdb,
			s: req.s,
			e: req.e,
			title: req.title,
			year: req.year,
			...src,
		});
		toast(t`Download added. It will show up in Jellyfin when it’s done.`, 2500);
		return r;
	} catch (err) {
		toast((err as Error).message);
		return null;
	}
}

/** the player's button: the version playing now */
export const downloadVersion = (req: PlayRequest, live: Playing) => download(req, {
	url: live.url ?? '',
	label: [RES_LABEL[live.res], live.tier && tierTag(live.tier)].filter(Boolean).join(' '),
});

const pad = (n?: number) => String(n).padStart(2, '0');
const label = (d: Download) => d.title + (d.q.s ? ` S${pad(d.q.s)}E${pad(d.q.e)}` : '');

// downloads are shared by the household: the server keeps their errors in English
const ERRORS: Record<string, () => string> = {
	'Already in Jellyfin': () => t`Already in Jellyfin`,
	'Interrupted': () => t`Interrupted`,
	'Incomplete copy': () => t`The copy stopped before the end`,
	'No longer in qBittorrent or on the indexer: search again':
		() => t`This version is gone from qBittorrent and from the torrent site. Search again.`,
};

function status(d: Download): ['' | 'good' | 'bad' | 'low', string] {
	const seedbox = names().seedbox;
	const n = d.wb?.progress ?? 0;
	const err = ERRORS[d.err ?? '']?.() ?? d.err ?? '';
	const pct = d.total ? Math.floor(d.done / d.total * 100) : 0;
	const copying = [
		`${pct} %`,
		d.speed && `${(d.speed / 1e6).toFixed(0)} ${t`MB/s`}`,
		d.total && bytes(d.total),
	].filter(Boolean).join(', ');
	const all: Record<string, ReturnType<typeof status>> = {
		queued: ['', t`Waiting`],
		whatbox: ['low', t`${seedbox} is downloading it: ${n}%`],
		copying: ['', copying],
		done: ['good', t`In Jellyfin`],
		error: ['bad', t`Failed: ${err}`],
		cancelled: ['', t`Cancelled`],
	};
	return all[d.status] ?? ['', d.status];
}

const sizeOf = (x: Stream) => {
	if (x.info?.size) return bytes(x.info.size);
	return /💾 ([\d.]+ \w+)/.exec(x.title)?.[1]
		?.replace(/[\d.]+/, n => dec(n)).replace('GB', t`GB`).replace('MB', t`MB`);
};

function from(x: Stream) {
	const { indexer, seedbox } = names();
	if (x.tz) return t`${indexer}, downloaded by ${seedbox}`;
	if (x.lib) {
		const name = seedbox;
		return t`In ${name}`;
	}
	return 'Real-Debrid';
}

function Running({
	st,
	set,
}: { st: Downloads; set: (s: Downloads) => void }) {
	const recent = (d: Download) => ACTIVE.test(d.status) || Date.now() - d.at < 36e5 * 6;
	const live = st.downloads.filter(recent).slice(0, 8);
	if (!live.length) return null;
	const cancel = async (d: Download) => {
		if (ACTIVE.test(d.status)) set(await post('download/cancel', { id: d.id }));
	};
	return (
		<>
			<h5>{t`Downloads`}</h5>
			{live.map(d => {
				const [tone, txt] = status(d);
				return (
					<Opt
						key={d.id}
						title={label(d)}
						sub={(
							<>
								<span className={cx(s.state, tone && s[tone])}>{txt}</span>
								{d.label ? `, ${d.label}` : ''}
							</>
						)}
						lead={ACTIVE.test(d.status) ? <Badge><Icon name="close" /></Badge> : undefined}
						onClick={() => cancel(d)}
					/>
				);
			})}
		</>
	);
}

function DownloadSheet({
	req,
	srcs,
	first,
}: { req: PlayRequest; srcs: Stream[]; first: Downloads }) {
	const [st, set] = useState(first);
	useEffect(() => { // progress while the sheet stays open
		const timer = setInterval(() => get('downloads').then(set, () => {}), 2000);
		return () => clearInterval(timer);
	}, []);
	const here = srcs.filter(x => x.lib && x.name === 'Jellyfin');
	const size = st.free != null ? bytes(st.free) : '';
	const add = async (x: Stream) => {
		const r = await download(req, {
			url: x.url,
			label: [RES_LABEL[x.res], badge(x.tag)[1]].filter(Boolean).join(' '),
			size: x.info?.size,
		});
		if (r) set(r);
	};
	const rest = srcs.filter(x => !here.includes(x));
	return (
		<Sheet title={t`Download into Jellyfin`}>
			<p className={tx.empty}>
				{size && t`${size} free on the Jellyfin drive.`}
				{!st.jellyfin && ' '
					+ t`Jellyfin won’t show these files until its API key is added in the server settings.`}
			</p>
			<Running st={st} set={set} />
			{here.length > 0 && <h5>{t`Already in Jellyfin`}</h5>}
			{here.map(x => <p key={x.url} className={tx.empty}>{x.title.split('\n')[0]}</p>)}
			<h5>{t`Available versions`}</h5>
			{rest.map(x => (
				<Opt
					key={x.url}
					lead={<Tag tag={x.tag} />}
					title={x.title.split('\n')[0]}
					sub={[RES_LABEL[x.res], sizeOf(x), from(x)].filter(Boolean).join(', ')}
					onClick={() => add(x)}
				/>
			))}
			{!rest.length && (
				<p className={tx.empty}>{t`No version of this title can be downloaded right now.`}</p>
			)}
		</Sheet>
	);
}

/** every version of a film or episode that can be downloaded, and the downloads under way */
export async function downloadSheet(req: PlayRequest) {
	openSheet(
		<Sheet title={t`Download into Jellyfin`}>
			<p className={tx.empty}>{t`Looking for versions…`}</p>
		</Sheet>,
	);
	const [list, first] = await Promise.all([get('streams', {
		type: req.type,
		imdb: req.imdb,
		s: req.s,
		e: req.e,
	}), get('downloads')]);
	const srcs = list.filter(x => x.cached || x.tz || x.lib);
	openSheet(<DownloadSheet req={req} srcs={srcs} first={first} />);
}
