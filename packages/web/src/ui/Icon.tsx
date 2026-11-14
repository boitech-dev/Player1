import s from './Icon.module.scss';

const PATHS = {
	dl: 'M12 3.5v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14',
	users: 'M15 19v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 3 17.5V19M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM21 19v-1.5a3.5 3.5 0 0 0-2.5-3.35M15.5 4.15a3.5 3.5 0 0 1 0 6.7',
	disk: 'M3 14h18v5H3zM5 14l2.5-9h9l2.5 9M7 16.5h2',
	swap: 'M7 20V4M3.5 7.5L7 4l3.5 3.5M17 4v16M13.5 16.5L17 20l3.5-3.5',
	clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7.5V12l3 2',
	bolt: 'M13 2.5L4.5 13.5h7l-1 8 8.5-11h-7z',
	play: 'M7 4.5v15l13-7.5z',
	pause: 'M6.5 4h4v16h-4zM13.5 4h4v16h-4z',
	back: 'M15 18l-6-6 6-6',
	rew: 'M11 17l-5-5 5-5M18 17l-5-5 5-5',
	fwd: 'M13 17l5-5-5-5M6 17l5-5-5-5',
	prev: 'M18 6v12l-9-6zM6 6v12',
	next: 'M6 6v12l9-6zM18 6v12',
	send: 'M21 3L10 14M21 3l-7 18-4-8-8-4z',
	star: 'M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z',
	list: 'M4 6h16M4 12h16M4 18h10',
	full: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
	check: 'M5 12l5 5 9-10',
	close: 'M6 6l12 12M18 6L6 18',
	audio: 'M11 5L6 9H3v6h3l5 4zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13',
	sub: 'M3 5h18v14H3zM7 12h3M13 12h4M7 15.5h10',
	hd: 'M3 5h18v14H3zM7 9v6M7 12h3M10 9v6M14 9v6h1.5a2.5 3 0 0 0 0-6z',
	heart: 'M12 20.5S3.5 15.3 3.5 9.2A4.3 4.3 0 0 1 12 7a4.3 4.3 0 0 1 8.5 2.2c0 6.1-8.5 11.3-8.5 11.3z',
	src: 'M4 7h16M4 12h16M4 17h16',
	search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
	plus: 'M12 5v14M5 12h14',
	film: 'M4 4h16v16H4zM8 4v16M16 4v16M4 9h4M4 15h4M16 9h4M16 15h4',
	layers: 'M12 3l9 5-9 5-9-5zM3 12.5l9 5 9-5M3 17l9 5 9-5',
	books: 'M5 4v16M9 4v16M13.5 5l4 15M3 20h18',
	globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9s1.3-6.3 3.8-9z',
	screen: 'M3 5h18v12H3zM8 21h8M12 17v4',
	cats: 'M5.2 3h3.6A2.2 2.2 0 0 1 11 5.2v3.6A2.2 2.2 0 0 1 8.8 11H5.2A2.2 2.2 0 0 1 3 8.8V5.2A2.2 2.2 0 0 1 5.2 3zM15.2 3h3.6A2.2 2.2 0 0 1 21 5.2v3.6a2.2 2.2 0 0 1-2.2 2.2h-3.6A2.2 2.2 0 0 1 13 8.8V5.2A2.2 2.2 0 0 1 15.2 3zM5.2 13h3.6a2.2 2.2 0 0 1 2.2 2.2v3.6A2.2 2.2 0 0 1 8.8 21H5.2A2.2 2.2 0 0 1 3 18.8v-3.6A2.2 2.2 0 0 1 5.2 13zM15.2 13h3.6a2.2 2.2 0 0 1 2.2 2.2v3.6a2.2 2.2 0 0 1-2.2 2.2h-3.6a2.2 2.2 0 0 1-2.2-2.2v-3.6a2.2 2.2 0 0 1 2.2-2.2z',
	discover: 'M7.5 2.5h9A2.5 2.5 0 0 1 19 5v14a2.5 2.5 0 0 1-2.5 2.5h-9A2.5 2.5 0 0 1 5 19V5a2.5 2.5 0 0 1 2.5-2.5zM12 16.6s-4.2-2.5-4.2-5.4a2.3 2.3 0 0 1 4.2-1.3 2.3 2.3 0 0 1 4.2 1.3c0 2.9-4.2 5.4-4.2 5.4z',
	rewatch: 'M12 2.5a9.5 9.5 0 1 0 0 19 9.5 9.5 0 0 0 0-19zM10 8.3v7.4l6-3.7z',
};

export type IconName = keyof typeof PATHS;

/** a line icon; filled draws it solid */
export function Icon({
	name,
	filled,
}: { name: IconName; filled?: boolean }) {
	return (
		<svg className={filled ? `${s.i} ${s.f}` : s.i} viewBox="0 0 24 24" aria-hidden="true">
			<path
				d={PATHS[name]}
				fillRule={name === 'discover' || name === 'rewatch' ? 'evenodd' : undefined}
			/>
		</svg>
	);
}
