import { t } from '@lingui/core/macro';
import {
	useEffect,
	useRef,
	useState,
} from 'react';

import {
	type Episode,
	FAVORITES,
	type MediaType,
	type Meta,
	type PlayRequest,
	type Progress,
	type Season,
} from '@player1/shared/api';
import { tierTag } from '@player1/shared/langs';

import {
	go,
	playHash,
} from '../app/router.ts';
import {
	app,
	currentPreset,
	presetSays,
	setApp,
	useApp,
} from '../app/state.ts';
import {
	get,
	post,
} from '../lib/api.ts';
import {
	episodeName,
	hms,
} from '../lib/format.ts';
import { tierSays } from '../lib/tiers.ts';
import { downloadSheet } from '../sheets/download.tsx';
import {
	listsSheet,
	toggleFavorite,
} from '../sheets/lists.tsx';
import { qualitySheet } from '../sheets/quality.tsx';
import { sendSheet } from '../sheets/send.tsx';
import {
	titleKey,
	titleLanguageSheet,
} from '../sheets/titleLanguage.tsx';
import { Button } from '../ui/Button.tsx';
import { cx } from '../ui/cx.ts';
import { Icon } from '../ui/Icon.tsx';
import {
	useLanding,
	useLoad,
} from '../ui/load.ts';
import tx from '../ui/text.module.scss';
import { toast } from '../ui/toast.tsx';
import pg from './page.module.scss';
import t_ from './Title.module.scss';

// a title's page: its backdrop and facts, what to play next, and for a series its episodes

const pkey = (imdb: string, s?: number, e?: number) => imdb + (e ? `:${s}:${e}` : '');

/** a picture while it loads: the episode's still at full size, else the title's backdrop */
const artOf = (still: string | undefined, backdrop: string | undefined) =>
	still?.replace(/\/w\d+\//, '/original/') ?? backdrop;

interface Ep {
	s?: number;
	e?: number;
}

function request(m: Meta, { s, e }: Ep): PlayRequest {
	const still = m.seasons?.find(x => x.n === s)?.episodes?.find(x => x.e === e)?.still;
	return {
		type: m.type,
		imdb: m.imdb ?? '',
		s,
		e,
		lang: m.lang,
		title: m.title,
		ep: e ? episodeName(s ?? 1, e) : '',
		sub: m.sub,
		id: m.id,
		year: m.year,
		poster: m.poster,
		art: artOf(still, m.backdrop),
		tier: app().titleModes[titleKey(m)],
	};
}

interface Next {
	s: number;
	e: number;
	resume?: number;
	again?: boolean;
}

/** the episode after this one, if there is one */
function after(m: Meta, s: number, e: number) {
	const seasons = m.seasons ?? [];
	const season = seasons.find(x => x.n === s);
	const count = season?.count ?? season?.episodes?.length ?? 0;
	if (e < count) return {
		s,
		e: e + 1,
	};
	const later = seasons.find(x => x.n > s);
	return later && {
		s: later.n,
		e: 1,
	};
}

/** where a series stands: the episode in progress, else the one after the last finished, else
 *  the first */
function nextEp(m: Meta, progress: Record<string, Progress>): Next {
	const first = {
		s: m.seasons?.[0]?.n ?? 1,
		e: 1,
	};
	const last = Object.entries(progress)
		.filter(([k]) => k.startsWith(m.imdb + ':'))
		.map(([k, p]) => ({
			...p,
			s: Number(k.split(':')[1]),
			e: Number(k.split(':')[2]),
		}))
		.sort((a, b) => b.at - a.at)[0];
	if (!last) return first;
	if (!last.watched) return {
		s: last.s,
		e: last.e,
		resume: last.pos,
	};
	return after(m, last.s, last.e) ?? {
		...first,
		again: true,
	};
}

async function markSeen(m: Meta, key: string, on: boolean, ep: Ep = {}) {
	const entry = await post('progress', {
		key,
		watched: on,
		info: {
			id: m.id,
			type: m.type,
			title: m.title,
			poster: m.poster,
			imdb: m.imdb,
			lang: m.lang,
			...ep,
			// "Resume" goes on from an episode marked by hand too
			next: ep.e ? after(m, ep.s ?? 1, ep.e) : undefined,
		},
	});
	setApp({
		progress: {
			...app().progress,
			[key]: entry,
		},
	});
	toast(on ? t`Marked as seen` : t`Marked as not seen`, 1500);
}

function playLabel(m: Meta, progress: Record<string, Progress>) {
	if (m.type === 'movie') {
		const mp = progress[pkey(m.imdb!)];
		const time = hms(mp?.pos ?? 0);
		return mp && !mp.watched && mp.pos > 30 ? t`Resume at ${time}` : t`Play`;
	}
	const nx = nextEp(m, progress);
	const { s, e } = nx;
	if (nx.again) return t`Watch again from the start`;
	return nx.resume ? t`Resume S${s} E${e}` : t`Play S${s} E${e}`;
}

function Facts({ m }: { m: Meta }) {
	const n = m.seasons?.length ?? 0;
	const runtime = m.runtime;
	const bits = [
		m.year,
		...(m.genres ?? []).slice(0, 3),
		runtime && `${runtime} min`,
		m.seasons && (n > 1 ? t`${n} seasons` : t`${n} season`),
	].filter(Boolean);
	return <div className={pg.facts}>{bits.map(x => <span key={String(x)}>{x}</span>)}</div>;
}

function Hint({ m }: { m: Meta }) {
	const s = useApp();
	const own = s.titleModes[titleKey(m)];
	if (!m.imdb) {
		return (
			<p className={tx.hint}>
				{t`This title can’t be played: it isn’t listed on IMDb, which Player1 needs to find sources.`}
			</p>
		);
	}
	if (own) {
		const mode = tierSays(own);
		return <p className={tx.hint}>{t`${mode}. Chosen for this title only.`}</p>;
	}
	return <p className={tx.hint}>{presetSays(currentPreset(s))}</p>;
}

/** Play and Send: the film, or the series' next episode */
function PlayButtons({
	m,
	ep,
}: { m: Meta; ep: Ep }) {
	const { progress } = useApp();
	return (
		<>
			<Button tone="lampe" data-land onClick={() => go(playHash(request(m, ep)))}>
				<Icon name="play" filled />
				{playLabel(m, progress)}
			</Button>
			<Button onClick={() => sendSheet(request(m, ep))}>
				<Icon name="send" />
				{t`Send`}
			</Button>
		</>
	);
}

function LanguageButton({ m }: { m: Meta }) {
	const own = useApp().titleModes[titleKey(m)];
	return (
		<Button on={!!own} onClick={() => titleLanguageSheet(m)}>
			<Icon name="audio" />
			{own ? tierTag(own) : t`Language`}
		</Button>
	);
}

function FavoriteButton({ m }: { m: Meta }) {
	const fav = !!useApp().lists[FAVORITES]?.some(x => x.id === m.id);
	return (
		<Button
			on={fav}
			aria-pressed={fav}
			onClick={() => toggleFavorite(m, !fav)}
		>
			<Icon name="star" filled={fav} />
			{fav ? t`In my favorites` : t`Favorite`}
		</Button>
	);
}

/** a film: seen or not, and every source to pick from */
function MovieButtons({ m }: { m: Meta }) {
	const seen = !!useApp().progress[pkey(m.imdb!)]?.watched;
	return (
		<>
			<Button
				on={seen}
				aria-pressed={seen}
				onClick={() => markSeen(m, pkey(m.imdb!), !seen)}
			>
				<Icon name="check" />
				{seen ? t`Seen` : t`Mark as seen`}
			</Button>
			<Button tone="ghost" onClick={() => qualitySheet(request(m, {}))}>
				<Icon name="src" />
				{t`Sources`}
			</Button>
		</>
	);
}

function Actions({ m }: { m: Meta }) {
	const { progress } = useApp();
	const movie = m.type === 'movie' && !!m.imdb;
	const series = m.type === 'series' && !!m.imdb && !!m.seasons?.length;
	const ep: Ep = series ? nextEp(m, progress) : {};
	const canPlay = movie || series;
	return (
		<div className={pg.actions}>
			{canPlay && <PlayButtons m={m} ep={ep} />}
			{m.imdb && <LanguageButton m={m} />}
			<FavoriteButton m={m} />
			<Button onClick={() => listsSheet(m)}><Icon name="list" />{t`Lists`}</Button>
			{canPlay && (
				<Button onClick={() => downloadSheet(request(m, ep))}>
					<Icon name="dl" />
					{t`Download`}
				</Button>
			)}
			{movie && <MovieButtons m={m} />}
		</div>
	);
}

function EpisodeRow({
	m,
	n,
	x,
}: { m: Meta; n: number; x: Episode }) {
	const { progress } = useApp();
	const p = progress[pkey(m.imdb ?? '', n, x.e)];
	const pct = p?.dur && !p.watched ? Math.round(p.pos / p.dur * 100) : 0;
	const e = x.e;
	const ep = {
		s: n,
		e,
	};
	return (
		<div className={cx(t_.ep, p?.watched && t_.seen)}>
			<button className={t_.open} onClick={() => go(playHash(request(m, ep)))}>
				<span className={t_.still} style={{ backgroundImage: x.still ? `url('${x.still}')` : undefined }}>
					{!!pct && <i style={{ width: pct + '%' }} />}
				</span>
				<div>
					<h4><b>{x.e}</b>{x.title}</h4>
					<p>{x.overview}</p>
				</div>
			</button>
			<Button
				icon
				tone="ghost"
				aria-pressed={!!p?.watched}
				aria-label={p?.watched ? t`Seen: episode ${e}` : t`Mark as seen: episode ${e}`}
				onClick={() => markSeen(m, pkey(m.imdb ?? '', n, e), !p?.watched, ep)}
			>
				<Icon name="check" />
			</Button>
			<Button
				icon
				tone="ghost"
				aria-label={t`Download episode ${e} into Jellyfin`}
				onClick={() => downloadSheet(request(m, ep))}
			>
				<Icon name="dl" />
			</Button>
			<Button
				icon
				tone="ghost"
				aria-label={t`Send episode ${e}`}
				onClick={() => sendSheet(request(m, ep))}
			>
				<Icon name="send" />
			</Button>
		</div>
	);
}

function Seasons({ m }: { m: Meta }) {
	const { progress } = useApp();
	const seasons = m.seasons;
	const [n, setN] = useState(() => nextEp(m, progress).s);
	const [eps, setEps] = useState<Episode[] | null>(null);
	useEffect(() => {
		const s: Season | undefined = seasons?.find(x => x.n === n);
		if (!s) return;
		if (s.episodes) return setEps(s.episodes);
		let live = true;
		setEps(null);
		get('season', {
			id: m.id,
			n,
		}).then(list => {
			s.episodes = list; // kept: the play request takes the episode's still from it
			if (live) setEps(list);
		}, (err: Error) => toast(err.message));
		return () => {
			live = false;
		};
	}, [m.id, n, seasons]);
	if (!seasons?.length) return null;
	return (
		<>
			<div className={t_.seasons}>
				{seasons.map(s => (
					<Button key={s.n} aria-pressed={s.n === n} onClick={() => setN(s.n)}>
						{s.name}
					</Button>
				))}
			</div>
			<div className={t_.eps}>{eps?.map(x => <EpisodeRow key={x.e} m={m} n={n} x={x} />)}</div>
		</>
	);
}

export function Title({
	type,
	id,
}: { type: MediaType; id: string }) {
	const m = useLoad(() => get('meta', {
		type,
		id,
	}), [type, id]);
	const ref = useRef<HTMLDivElement>(null);
	useLanding(ref, m);
	if (!m) return <div className={pg.pad} />;
	return (
		<div ref={ref}>
			<section className={pg.hero} style={{ backgroundImage: `url('${m.backdrop ?? ''}')` }}>
				<div>
					<h1 className={pg.marquee}>{m.title}</h1>
					{m.sub && <p className={pg.aka}>{m.sub}</p>}
					<Facts m={m} />
					<p className={pg.overview}>{m.overview}</p>
					<Actions m={m} />
					<Hint m={m} />
				</div>
			</section>
			{type === 'series' && <Seasons m={m} />}
		</div>
	);
}
