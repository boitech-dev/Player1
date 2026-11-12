import { t } from '@lingui/core/macro';
import {
	useEffect,
	useRef,
	useSyncExternalStore,
} from 'react';

import { RES_LABEL } from '@player1/shared/release';

import { tvApp } from '../lib/device.ts';
import { hms } from '../lib/format.ts';
import { downloadVersion } from '../sheets/download.tsx';
import { qualitySheet } from '../sheets/quality.tsx';
import { sendSheet } from '../sheets/send.tsx';
import { trackSheet } from '../sheets/tracks.tsx';
import { Button } from '../ui/Button.tsx';
import { cx } from '../ui/cx.ts';
import { Icon } from '../ui/Icon.tsx';
import { toast } from '../ui/toast.tsx';
import {
	attach,
	currentRequest,
	getView,
	goNext,
	goPrev,
	type PlayerView,
	seekBy,
	seekTo,
	startOver,
	subscribe,
	togglePlay,
	wake,
} from './engine.ts';
import s from './Player.module.scss';

// the play page's screen: the video, its controls, the loading picture and the next-episode card.
// Always mounted (the engine keeps the <video> across titles); shown while the engine is open.

const BLANK = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const canFull = document.fullscreenEnabled && !tvApp;

function Wait({ view }: { view: PlayerView }) {
	// a picture behind the loading message, whatever the player (the video's own poster is a blank
	// pixel: Android WebViews otherwise draw a grey play button, and Movi a black canvas)
	const art = view.art
		? `radial-gradient(closest-side, #17121fd9, #17121f8c), url("${view.art}")`
		: undefined;
	return (
		<div className={s.wait} id="wait" hidden={!view.wait} style={{ backgroundImage: art }}>
			<div className={s.beam} hidden={!view.wait?.spin} />
			<p>{view.wait?.msg}</p>
			<small>{view.wait?.sub}</small>
		</div>
	);
}

function NextUp({ next }: { next: PlayerView['next'] }) {
	const go = useRef<HTMLButtonElement>(null);
	const counting = next?.countdown != null;
	useEffect(() => {
		if (counting) go.current?.focus();
	}, [counting]);
	const n = next?.countdown;
	return (
		<div className={s.nextUp} id="nextUp" hidden={!next}>
			<small>{t`Next episode`}</small>
			<b>{next?.name}</b>
			<Button tone="lampe" ref={go} onClick={goNext}>
				<Icon name="play" filled />
				{n != null ? t`Playing in ${n} s` : t`Play`}
			</Button>
		</div>
	);
}

function Bar({ view }: { view: PlayerView }) {
	const pct = view.total ? view.now / view.total * 100 : 0;
	return (
		<>
			<div
				className={s.bar}
				id="bar"
				onClick={e => {
					const r = e.currentTarget.getBoundingClientRect();
					seekTo((e.clientX - r.left) / r.width * view.total);
				}}
			>
				<i style={{ width: pct + '%' }} />
			</div>
			<div className={s.times}>
				<span>{hms(view.now)}</span>
				<span>{view.total ? hms(view.total) : ''}</span>
			</div>
		</>
	);
}

function TrackButtons({ view }: { view: PlayerView }) {
	const live = view.live;
	if (!live) return null;
	const own = !!(live.model || live.wb); // RD's transcoder or the device: tracks can change
	const audio = live.audio.find(a => a.id === view.sel.audio)?.name ?? t`Audio`;
	const sub = live.subs.find(a => a.id === view.sel.sub)?.name ?? t`No subtitles`;
	return (
		<>
			<Button
				className={s.track}
				id="pQual"
				aria-label={t`Quality`}
				onClick={() => qualitySheet(currentRequest()!)}
			>
				<Icon name="hd" />
				<span>{RES_LABEL[live.res] ?? t`Quality`}</span>
			</Button>
			{own && live.audio.length > 1 && (
				<Button className={s.track} id="pAudio" aria-label={t`Audio`} onClick={() => trackSheet('audio')}>
					<Icon name="audio" />
					<span>{audio}</span>
				</Button>
			)}
			{own && live.subs.length > 0 && (
				<Button className={s.track} id="pSub" aria-label={t`Subtitles`} onClick={() => trackSheet('sub')}>
					<Icon name="sub" />
					<span>{sub}</span>
				</Button>
			)}
		</>
	);
}

function download(view: PlayerView) {
	const live = view.live;
	if (!live) return;
	if (live.url?.startsWith('jf:')) return toast(t`This version is already in Jellyfin`);
	downloadVersion(currentRequest()!, live);
}

function Controls({ view }: { view: PlayerView }) {
	const playing = !view.paused;
	return (
		<div className={s.chrome}>
			<div className={s.top}>
				<Button icon id="pBack" aria-label={t`Back`} onClick={() => history.back()}>
					<Icon name="back" />
				</Button>
				<div>
					<h3>{view.title}</h3>
					<small>{view.info}</small>
				</div>
				<span className={s.spacer} />
				{view.restart && <Button onClick={startOver}>{t`Start over`}</Button>}
			</div>
			<div className={s.bottom}>
				<Bar view={view} />
				<div className={s.ctrls}>
					{view.hasPrev && (
						<Button icon aria-label={t`Previous episode`} onClick={goPrev}>
							<Icon name="prev" />
						</Button>
					)}
					<Button icon aria-label={t`Back 10 seconds`} onClick={() => seekBy(-10)}>
						<Icon name="rew" />
					</Button>
					<Button
						icon
						className={s.pp}
						id="pp"
						aria-label={playing ? t`Pause` : t`Play`}
						onClick={togglePlay}
					>
						<Icon name={playing ? 'pause' : 'play'} filled />
					</Button>
					<Button icon aria-label={t`Forward 30 seconds`} onClick={() => seekBy(30)}>
						<Icon name="fwd" />
					</Button>
					{view.hasNext && (
						<Button icon aria-label={t`Next episode`} onClick={goNext}>
							<Icon name="next" />
						</Button>
					)}
					<span className={s.spacer} />
					<TrackButtons view={view} />
					<Button
						icon
						aria-label={t`Download this version into Jellyfin`}
						onClick={() => download(view)}
					>
						<Icon name="dl" />
					</Button>
					<Button
						icon
						aria-label={t`Send to another device`}
						onClick={() => sendSheet(currentRequest()!)}
					>
						<Icon name="send" />
					</Button>
					{canFull && (
						<Button icon aria-label={t`Full screen`} onClick={fullScreen}>
							<Icon name="full" />
						</Button>
					)}
				</div>
			</div>
		</div>
	);
}

const fullScreen = () => document.fullscreenElement
	? document.exitFullscreen()
	: document.querySelector('#player')?.requestFullscreen();

export function Player() {
	const view = useSyncExternalStore(subscribe, getView);
	const video = useRef<HTMLVideoElement>(null);
	const host = useRef<HTMLDivElement>(null);
	useEffect(() => attach(video.current!, host.current!), []);
	return (
		<div
			id="player"
			className={cx(s.player, view.open && s.open, view.idle && s.idle)}
			data-open={view.open || undefined}
			onMouseMove={wake}
			onTouchStart={wake}
		>
			<video
				id="video"
				ref={video}
				playsInline
				poster={BLANK}
				onClick={() => {
					togglePlay();
					wake();
				}}
			/>
			<div ref={host} style={{ display: 'contents' }} onClick={togglePlay} />
			<div className={s.cue} id="cue" aria-live="off" dangerouslySetInnerHTML={{ __html: view.cue }} />
			<div className={s.ncue} id="ncue" aria-hidden="true">
				{view.imgCues.map((c, i) => (
					<img
						key={i}
						src={c.img}
						alt=""
						style={{
							left: c.x * 100 + '%',
							top: c.y * 100 + '%',
							width: c.w * 100 + '%',
						}}
					/>
				))}
			</div>
			<NextUp next={view.next} />
			<Wait view={view} />
			<Controls view={view} />
		</div>
	);
}
