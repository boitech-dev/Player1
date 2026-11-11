// The contract between the server and the web app: every route, what it takes and what it answers.
// GET routes take a query string, POST routes a JSON body; both answer JSON, errors as
// { error } with a non-2xx status.

import type {
	PresetLang,
	StreamTag,
	Tier,
	Track,
	TrackPick,
} from './langs.ts';
import type { VideoInfo } from './release.ts';

export type MediaType = 'movie' | 'series';

// --- catalog ---

/** a title as a poster card shows it; id is tmdb:<n> or an IMDb id (Cinemeta) */
export interface Item {
	id: string;
	type: MediaType;
	title: string;
	/** another name it goes by (English, French) */
	sub?: string;
	year: string;
	poster?: string;
	backdrop?: string;
	overview?: string;
	anime?: boolean;
}

export interface Row {
	key?: string;
	title: string;
	items: Item[];
	/** another page exists */
	more?: boolean;
}

export interface Genre {
	id: number;
	name: string;
}

export interface Genres {
	movie: Genre[];
	tv: Genre[];
	/** the picked rows (trending, anime…) */
	cats: { key: string; title: string }[];
	/** artwork per tile key: a backdrop and three posters */
	art: Record<string, { backdrop?: string; posters: string[] }>;
}

export interface Episode {
	e: number;
	title: string;
	overview?: string;
	still?: string;
	runtime?: number;
}

export interface Season {
	n: number;
	name: string;
	count?: number;
	/** known up front for Cinemeta titles, fetched per season for TMDB ones */
	episodes?: Episode[];
}

/** a title page */
export interface Meta extends Item {
	imdb?: string;
	/** original language (ISO 639-1) */
	lang?: string | null;
	genres?: string[];
	runtime?: number | null;
	seasons?: Season[];
}

// --- the household ---

export interface ProfileSummary {
	id: string;
	name: string;
	color: number;
	/** a picture from the web app's avatars/ (people-3), else the name's initial */
	avatar?: string;
	/** interface language */
	lang?: string;
}

export interface Preset {
	id: string;
	name: string;
	langs: PresetLang[];
}

export interface ListEntry {
	id: string;
	type: MediaType;
	title: string;
	sub?: string;
	year?: string;
	poster?: string;
}

/** title details kept with a progress entry, so "Resume" can show and replay it */
export interface ProgressInfo {
	id?: string;
	type?: MediaType;
	title?: string;
	poster?: string;
	art?: string;
	imdb?: string;
	lang?: string | null;
	s?: number;
	e?: number;
}

export interface Progress extends ProgressInfo {
	pos: number;
	dur: number;
	watched: boolean;
	at: number;
}

/** "Favoris" and "À voir" are the two lists every profile has (their keys stay French) */
export const FAVORITES = 'Favoris';
export const WATCHLIST = 'À voir';

/** what a profile still has to go through: its own details and its languages, or its languages */
export type Welcome = 'all' | 'languages';

export interface State {
	profile: string;
	/** this profile hasn't been welcomed yet (a new install's first profile, a profile just added) */
	welcome?: Welcome;
	profiles: ProfileSummary[];
	presets: Preset[];
	preset: string;
	lists: Record<string, ListEntry[]>;
	tmdb: boolean;
	/** what this server calls its indexer and torrent client (C411, Whatbox…) */
	names: { indexer: string; seedbox: string };
	library: boolean;
	/** per title (series:tmdb:42509): a tier forced for it */
	titleModes: Record<string, Tier>;
	/** per film (imdb) or episode (imdb:s:e) */
	progress: Record<string, Progress>;
}

// --- sources and playback ---

export interface StreamInfo {
	title: string;
	size?: number;
	seeders?: number;
	leechers?: number;
	grabs?: number;
	date?: string;
	details?: string;
	free?: boolean;
}

/**
 * One way to get a title: a Real-Debrid source (url = the addon's resolve link), an indexer
 * release (tz:<hash>), a qBittorrent file (wb:<hash>) or a Jellyfin file (jf:<path>).
 */
export interface Stream {
	name: string;
	title: string;
	url: string;
	/** ready on Real-Debrid */
	cached: boolean;
	tz?: boolean;
	lib?: boolean;
	tag: StreamTag;
	res: number;
	seeds: number;
	info?: StreamInfo;
}

export interface StreamsQuery {
	type: MediaType;
	imdb: string;
	s?: number;
	e?: number;
}

/** what a device asks to play; also the play page's address (#/play/<json>) */
export interface PlayRequest extends StreamsQuery {
	id: string;
	title: string;
	/** original language */
	lang?: string | null;
	/** a chosen source; none = the best one for the preset */
	url?: string;
	/** "Season 1, episode 2" */
	ep?: string;
	sub?: string;
	year?: string;
	poster?: string;
	/** full-screen picture while it loads */
	art?: string;
	/** a tier held for this title */
	tier?: Tier;
}

export interface PlayBody extends PlayRequest {
	/** the device's preferred resolution */
	quality?: number;
	/** formats it decodes well (h264,hevc10,4k,av1) */
	hw?: string;
	/** its measured link to this server, Mbit/s */
	net?: number;
	/** it may play the original file with its own decoder */
	direct?: 1;
	/** yes to downloading an indexer release */
	confirm?: 1;
}

export interface MediaTrack extends Track {
	index?: number;
	codec?: string;
	/** Blu-ray / DVD picture subtitles */
	image?: boolean;
	/** an OpenSubtitles file, drawn by the page */
	ext?: boolean;
	code?: string;
	url?: string;
}

export interface NextEpisode {
	s: number;
	e: number;
	name?: string;
	still?: string;
}

/** a file ready to play */
export interface Playing {
	file?: string;
	/** Real-Debrid's original file */
	direct?: string;
	/** Real-Debrid's transcoder, {audio} {subtitles} {quality} {format} to fill */
	model?: string;
	/** the file through this server's relay: the device decodes it */
	wb?: string;
	duration?: number;
	qualities?: Record<string, string>;
	audio: MediaTrack[];
	subs: MediaTrack[];
	tier?: Tier | null;
	pick: TrackPick | null;
	res: number;
	source?: string;
	url?: string;
	video?: VideoInfo;
	bitrate?: number;
	/** Real-Debrid's transcoder, kept as the fallback when the device plays the original */
	rd?: {
		model?: string;
		audio: MediaTrack[];
		subs: MediaTrack[];
		pick: TrackPick | null;
	};
	next?: NextEpisode | null;
}

export interface PendingInfo {
	status: 'queued' | 'downloading';
	progress: number;
	speed?: number;
	seeders?: number;
}

/** qBittorrent is still fetching the release */
export interface Pending {
	pending: PendingInfo;
	url: string;
	source?: string;
}

/** an indexer release, as the confirmation sheet shows it */
export interface Release extends StreamInfo {
	url: string;
	tag: StreamTag;
	res: number;
	/** where it comes from: the indexer, qBittorrent, Jellyfin */
	src: string;
}

export interface Account {
	up?: number;
	down?: number;
	ratio: number | null;
	after: number | null;
	allowed: boolean;
	blocked?: string;
	/** qBittorrent's free disk */
	disk: number | null;
}

export interface Offer extends Release {
	tier: Tier | null;
	account: Account;
	library: Release[];
	others: Release[];
}

/** nothing ready: an indexer release to download, and what plays at once instead */
export interface Confirm {
	confirm: Offer;
	fallback: Playing | null;
}

export type PlayReply = Playing | Pending | Confirm;

// --- downloads into Jellyfin ---

export type DownloadStatus = 'queued' | 'whatbox' | 'copying' | 'done' | 'error' | 'cancelled';

export interface Download {
	id: string;
	key: string;
	url: string;
	title: string;
	year?: string;
	label?: string;
	size?: number;
	q: StreamsQuery;
	status: DownloadStatus;
	at: number;
	done: number;
	total?: number;
	speed?: number;
	err?: string;
	/** qBittorrent's progress while it fetches the release */
	wb?: PendingInfo;
	file?: string;
	part?: string;
	retryAt?: number;
}

export interface Downloads {
	downloads: Download[];
	free: number | null;
	jellyfin: boolean;
}

export interface DownloadBody extends StreamsQuery {
	url: string;
	title: string;
	year?: string;
	label?: string;
	size?: number;
}

// --- devices ---

export interface Device {
	id: string;
	name: string;
}

/** pushed to a device on its event stream */
export interface DeviceMessage {
	preset?: string;
	play?: PlayRequest;
}

// --- server settings ---

export const SETTINGS = [
	'RD_TOKEN',
	'TMDB_KEY',
	'STREAM_ADDON',
	'TORZNAB_URL',
	'TORZNAB_KEY',
	'QBIT_URL',
	'QBIT_USER',
	'QBIT_PASS',
	'QBIT_FILES',
	'MEDIA_DIR',
	'JELLYFIN_URL',
	'JELLYFIN_KEY',
	'PUBLIC_URL',
	'UI_LANG',
	'UPDATES',
] as const;
export type SettingKey = (typeof SETTINGS)[number];

/** a setting as the settings screen sees it: secrets only say whether they are set */
export interface SettingView {
	value: string;
	set: boolean;
	/** a secret's last 4 characters */
	hint: string;
	/** set in .env: read-only here */
	env: boolean;
}

export type UpdateStatus = 'latest' | 'building' | 'trial' | 'updated' | 'failed' | 'rolled-back'
	| 'unreachable' | 'no-remote' | 'local-changes' | 'diverged';

export interface UpdateInfo {
	commit?: string;
	date?: string;
	status?: UpdateStatus;
	error?: string | null;
	checked?: number;
	behind?: boolean;
	tv?: 'building' | 'ok' | 'failed';
	tvError?: string | null;
	tvVersion?: number;
	/** run.mjs is in charge (automatic updates possible) */
	supervised: boolean;
}

export interface SettingsReply {
	update: UpdateInfo;
	values: Record<SettingKey, SettingView>;
	/** the address this page was opened at, the default public address */
	url: string;
}

export type ServiceId = 'rd' | 'tmdb' | 'addon' | 'indexer' | 'qbit' | 'jellyfin';

export type CheckError = 'refused' | 'unreachable' | 'timeout' | 'not-premium' | 'no-streams'
	| 'not-torznab' | 'files-missing' | 'files-not-found' | 'media-not-found' | 'empty' | 'unknown';

export interface CheckResult {
	ok: boolean;
	/** what the service said: account, version, name… */
	info?: Record<string, string | boolean | undefined>;
	/** a CheckError, or the service's own words */
	err?: string;
}

// --- the routes ---

export interface GetRoutes {
	state: { query: void; reply: State };
	home: { query: void; reply: Row[] };
	browse: { query: { key: string; page: number }; reply: Row };
	genres: { query: void; reply: Genres };
	discover: { query: { kind: string }; reply: Item[] };
	trailer: { query: { type: MediaType; id: string }; reply: { key?: string } };
	search: { query: { q: string }; reply: Item[] };
	meta: { query: { type: MediaType; id: string }; reply: Meta };
	season: { query: { id: string; n: number }; reply: Episode[] };
	streams: { query: StreamsQuery; reply: Stream[] };
	downloads: { query: void; reply: Downloads };
	devices: { query: void; reply: Device[] };
	setup: { query: void; reply: { needed: boolean; ok: boolean } };
	settings: { query: void; reply: SettingsReply };
	/** public, for a device looking for Player1 on its network: the address to reach this server at */
	here: { query: void; reply: { app: 'player1'; url: string } };
}

export interface PostRoutes {
	'profiles': {
		body: {
			id?: string;
			name?: string;
			color?: number;
			/** a picture's name, '' for the initial */
			avatar?: string;
			lang?: string;
			remove?: boolean;
		};
		reply: ProfileSummary[];
	};
	'titlemode': { body: { key: string; tier: Tier | null }; reply: Record<string, Tier> };
	'log': { body: { dev: string; msg: string }; reply: object };
	'progress': {
		body: { key: string; pos?: number; dur?: number; watched?: boolean; info?: ProgressInfo };
		reply: Progress;
	};
	/** a part of the welcome is done: 'profile' leaves the languages, 'languages' ends it */
	'welcome': { body: { done: 'profile' | 'languages' }; reply: { welcome?: Welcome } };
	'preset': { body: { id: string }; reply: { preset: string } };
	'presets': {
		body: { presets: (Omit<Preset, 'id'> & { id?: string })[] };
		reply: { presets: Preset[]; preset: string };
	};
	'lists': {
		body: { name: string; item: ListEntry; on: boolean };
		reply: Record<string, ListEntry[]>;
	};
	'download': { body: DownloadBody; reply: Downloads };
	'download/cancel': { body: { id: string }; reply: Downloads };
	'swipe': {
		body: { item: Item; verdict: 'hide' | 'later' | 'keep' | 'seen' };
		reply: { lists: Record<string, ListEntry[]> };
	};
	'play': { body: PlayBody; reply: PlayReply };
	'send': { body: { to: string; play: PlayRequest }; reply: object };
	'pair': { body: { name: string }; reply: { code: string; secret: string } };
	'pair/poll': { body: { secret: string }; reply: { ok: boolean } };
	'pair/approve': { body: { code: string }; reply: { name: string } };
	'settings': {
		body: { values: Partial<Record<SettingKey, string>> };
		reply: { restart: boolean };
	};
	'settings/check': {
		body: { name: ServiceId; values: Partial<Record<SettingKey, string>> };
		reply: CheckResult;
	};
	'settings/update': { body: { what: 'update' | 'tv' }; reply: UpdateInfo };
	/** installs the LG TV app on a TV in Developer Mode: its address, and the passphrase it shows */
	'settings/lg': { body: { host: string; code: string }; reply: { ok: boolean } };
}

export type GetPath = keyof GetRoutes;
export type PostPath = keyof PostRoutes;

/** the headers every request carries */
export const HEADERS = {
	/** the profile acting */
	profile: 'x-profile',
	/** the one-time setup link's token, on a fresh install */
	setup: 'x-setup',
	/** the device's interface language, for messages before a profile is known */
	lang: 'x-lang',
} as const;

/** the interface languages */
export const UI_LANGS = ['en', 'fr'] as const;
export type UiLang = (typeof UI_LANGS)[number];
export const isUiLang = (l: unknown): l is UiLang => UI_LANGS.includes(l as UiLang);
