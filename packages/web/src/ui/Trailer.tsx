import { t } from '@lingui/core/macro';
import {
	useEffect,
	useRef,
	useState,
	useSyncExternalStore,
} from 'react';

import type { Item } from '@player1/shared/api';

import { useRoute } from '../app/router.ts';
import { get } from '../lib/api.ts';
import { cx } from './cx.ts';
import s from './Trailer.module.scss';

// A title's trailer, behind the Discover deck, the home page's featured title, or the page while a
// poster is hovered. Two race to show it: YouTube's player, muted and hidden until its start-up buttons
// have gone (they come back with any play or seek command, so it gets as few as possible), and the
// server's copy of the same video (trailers.ts), at once once it plays; the first ready stays. Discover
// starts the next card's trailer early, hidden, so it's ready when that card comes up. Then it fades in, picture and sound together; before the page's first
// click or key it stays hidden, as browsers would only let it play muted. Half scrolled off, it fades
// out and pauses. A trailer YouTube only has in low definition is passed over for the next one.
// YouTube's iframe speaks postMessage, so no player script is needed.
const yt = (f: HTMLIFrameElement | null, func: string, ...args: unknown[]) =>
	f?.contentWindow?.postMessage(JSON.stringify({
		event: 'command',
		func,
		args,
	}), '*');

const BUTTONS = 3600; // ms YouTube's buttons stay after it starts playing
const OUT = 300; // ms, the fade out in Trailer.module.scss

// the qualities YouTube has for it stop below 720p
const lowDef = (q?: string[]) => !!q?.length && !q.some(l => l.startsWith('hd'));

// the volume from one level to another over ms
function ramp(set: (x: number) => void, from: number, to: number, ms: number) {
	let i = 0;
	const steps = ms / 100;
	set(from);
	const tick = setInterval(() => {
		set(Math.round(from + (to - from) * ++i / steps));
		if (i >= steps) clearInterval(tick);
	}, 100);
	return () => clearInterval(tick);
}

type Titled = Pick<Item, 'type' | 'id'>;

// the title a listing's card stands for while it's hovered or focused: its trailer plays behind the page
let previewed: Titled | undefined;
const fans = new Set<() => void>();
const follow = (f: () => void) => {
	fans.add(f);
	return () => fans.delete(f);
};
export function preview(i?: Titled) {
	if (i === previewed) return;
	previewed = i;
	fans.forEach(f => f());
}
export const usePreview = () => useSyncExternalStore(follow, () => previewed);

/** the previewed title's trailer, filling the screen behind the page */
export function PagePreview() {
	return <Trailer item={usePreview()} backdrop />;
}

export function Trailer({ item, className, wait = 1000, hidden = false, backdrop = false }: {
	item?: Titled;
	className?: string;
	wait?: number; // before asking, so fast swiping loads nothing
	hidden?: boolean; // plays on unseen, to show at once when this turns false
	backdrop?: boolean; // fills the screen behind the page, darkened
}) {
	const [keys, setKeys] = useState<string[]>([]);
	const [n, setN] = useState(0);
	const [on, setOn] = useState(false);
	const box = useRef<HTMLDivElement>(null);
	const frame = useRef<HTMLIFrameElement>(null);
	const vid = useRef<HTMLVideoElement>(null);
	const [file, setFile] = useState<string>(); // the server's copy, racing YouTube's player
	const [won, setWon] = useState<'yt' | 'file'>();
	const playsFile = useRef(() => {});
	const hide = useRef(hidden);
	const sync = useRef(() => {});
	const away = useRoute().route.page === 'play'; // the player is over the page: no trailer at all
	const key = keys[n];
	useEffect(() => {
		hide.current = hidden;
		sync.current();
	}, [hidden]);
	useEffect(() => {
		setOn(false);
		const gone = setTimeout(() => setKeys([]), OUT);
		if (!item) return () => clearTimeout(gone);
		let live = true;
		const ask = setTimeout(async () => {
			const r = await get('trailer', {
				type: item.type,
				id: item.id,
			}).catch(() => ({ keys: undefined }));
			if (!live || !r.keys?.length) return;
			clearTimeout(gone);
			setN(0);
			setKeys(r.keys);
		}, wait);
		return () => {
			live = false;
			clearTimeout(gone);
			clearTimeout(ask);
		};
	}, [item, wait]);
	useEffect(() => {
		setOn(false);
		setFile(undefined);
		setWon(undefined);
		const key = keys[n];
		if (!key || away) return;
		const f = () => frame.current;
		const v = () => vid.current;
		let mode: 'yt' | 'file' | undefined; // the one that showed first
		let playing = false; // YouTube's, since it last started
		let ytReady = false; // and its buttons have gone
		let fileReady = false; // the file plays
		let shown = false;
		let seen = true; // at least half on screen
		let held = false; // paused by us
		let live = true;
		let reveal: ReturnType<typeof setTimeout> | undefined;
		let hold: ReturnType<typeof setTimeout> | undefined;
		let fading = () => {};
		const volume = (x: number) => {
			if (mode !== 'file') yt(f(), 'setVolume', x);
			else if (v()) v()!.volume = x / 100;
		};
		const unmute = () => {
			if (mode !== 'file') yt(f(), 'unMute');
			else if (v()) v()!.muted = false;
		};
		const run = (go: boolean) => { // both until one has shown
			if (mode !== 'yt') void (go ? v()?.play().catch(() => {}) : v()?.pause());
			if (mode !== 'file') yt(f(), go ? 'playVideo' : 'pauseVideo');
		};
		// shows or hides it, sound with picture, as things stand
		sync.current = () => {
			const want = (ytReady || fileReady) && seen && !hide.current
				&& (navigator.userActivation?.hasBeenActive ?? true);
			if (want === shown) return;
			if (want && !mode) { // the first one ready wins, the other goes
				mode = fileReady ? 'file' : 'yt';
				setWon(mode);
			}
			shown = want;
			setOn(want);
			fading();
			if (want) unmute();
			fading = want ? ramp(volume, 0, 100, 2000) : ramp(volume, 100, 0, OUT);
		};
		playsFile.current = () => {
			fileReady = true;
			sync.current();
		};
		// the server's copy, fetched by now or in a few seconds
		get('trailerFile', { key }).then(({ height }) => {
			if (!live || !height || mode === 'yt') return;
			if (height < 720 && n + 1 < keys.length && !shown) return setN(n + 1);
			setFile(`/api/trailers/${key}.mp4`);
		}, () => {});
		const first = () => sync.current(); // the page's first click or key
		// YouTube's autoplay sometimes doesn't start
		const kick = setTimeout(() => playing || mode === 'file' || yt(f(), 'playVideo'), 4000);
		const state = (st?: number) => {
			if (st === 1 && !seen) yt(f(), 'pauseVideo'); // started while scrolled off
			else if (st === 1 && !playing) {
				playing = true;
				reveal = setTimeout(() => {
					ytReady = true;
					sync.current();
				}, BUTTONS);
			} else if (st === 2 && seen && !held) { // unmuting refused: it pauses instead
				yt(f(), 'mute');
				yt(f(), 'playVideo');
			}
		};
		const listen = (e: MessageEvent) => {
			if (!f() || e.source !== f()!.contentWindow) return; // another trailer's player
			let m: { event?: string; info?: { playerState?: number; availableQualityLevels?: string[] } };
			try {
				m = JSON.parse(e.data as string);
			} catch {
				return;
			}
			// unavailable here (blocked in this country, removed…): the next one, or none
			if (m.event === 'onError') return n + 1 < keys.length ? setN(n + 1) : setKeys([]);
			if (!shown && lowDef(m.info?.availableQualityLevels) && n + 1 < keys.length) return setN(n + 1);
			state(m.info?.playerState);
		};
		const watch = new IntersectionObserver(([e]) => {
			if (!e || seen === e.intersectionRatio >= 0.5) return;
			seen = !seen;
			clearTimeout(hold);
			if (seen) {
				if (held) run(true); // YouTube's shows again once its buttons have gone, the file at once
				held = false;
				sync.current();
				return;
			}
			clearTimeout(reveal);
			playing = false;
			ytReady = false;
			sync.current();
			hold = setTimeout(() => {
				held = true;
				run(false);
			}, OUT);
		}, { threshold: 0.5 });
		watch.observe(box.current!);
		addEventListener('message', listen);
		addEventListener('pointerdown', first);
		addEventListener('keydown', first);
		return () => {
			live = false;
			sync.current = () => {};
			playsFile.current = () => {};
			watch.disconnect();
			removeEventListener('message', listen);
			removeEventListener('pointerdown', first);
			removeEventListener('keydown', first);
			clearTimeout(kick);
			clearTimeout(reveal);
			clearTimeout(hold);
			fading();
		};
	}, [keys, n, away]);
	const loaded = () => {
		frame.current?.contentWindow?.postMessage(JSON.stringify({
			event: 'listening',
			id: 1,
		}), '*');
	};
	const q = key && new URLSearchParams({
		autoplay: '1',
		mute: '1',
		controls: '0',
		loop: '1',
		playlist: key,
		playsinline: '1',
		rel: '0',
		iv_load_policy: '3',
		disablekb: '1',
		enablejsapi: '1',
		origin: location.origin,
	});
	return (
		<div ref={box} className={cx(s.trailer, backdrop && s.backdrop, className, on && s.playing)}>
			{key && !away && won !== 'file' && (
				<iframe
					key={key}
					ref={frame}
					src={`https://www.youtube-nocookie.com/embed/${key}?${q}`}
					allow="autoplay; encrypted-media"
					tabIndex={-1}
					title={t`Trailer`}
					onLoad={loaded}
				/>
			)}
			{file && !away && won !== 'yt' && (
				<video
					key={file}
					ref={vid}
					src={file}
					muted
					autoPlay
					loop
					playsInline
					onPlaying={() => playsFile.current()}
				/>
			)}
		</div>
	);
}
