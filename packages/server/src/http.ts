// The HTTP side: the typed router behind /api, its auth, the settings and setup screens' routes,
// and the files: the web app, app icons, the device test's clips, the Android TV app.
import fs from 'node:fs';
import type {
	IncomingMessage,
	ServerResponse,
} from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type {
	GetPath,
	GetRoutes,
	PostPath,
	PostRoutes,
} from '@player1/shared/api';

import { check } from './checks.ts';
import {
	configured,
	DATA,
	save as saveSettings,
	setupToken,
	view as settingsView,
} from './config.ts';
import {
	authed,
	cookie,
	isHttps,
} from './cookie.ts';
import {
	profileOf,
	request,
} from './db.ts';
import { events } from './devices.ts';
import {
	i18nFor,
	UserError,
} from './i18n.ts';
import { installOnTv } from './lgtv.ts';
import {
	relay,
	sendRange,
} from './qbit.ts';
import {
	CLIPS,
	clipsReady,
	fetchClips,
	SAMPLES,
} from './samples.ts';
import { trailerPath } from './trailers.ts';
import {
	requestUpdate,
	storage,
	updateInfo,
} from './updates.ts';
import { errMsg } from './upstream.ts';

// --- the typed router: each handler takes its route's query (GET: raw strings, as the address
// gives them) or JSON body (POST), and answers its route's reply ---
export interface Ctx {
	req: IncomingMessage;
	res: ServerResponse;
}
type Reply<T> = T | Promise<T>;
export type RawQuery<Q> = Q extends object ? { [K in keyof Q]?: string } : Record<string, never>;
export type GetHandlers = {
	[P in GetPath]?: (q: RawQuery<GetRoutes[P]['query']>, c: Ctx) => Reply<GetRoutes[P]['reply']>;
};
export type PostHandlers = {
	[P in PostPath]?: (b: PostRoutes[P]['body'], c: Ctx) => Reply<PostRoutes[P]['reply']>;
};
type Handler = (input: never, c: Ctx) => unknown;
export interface Routes {
	gets: GetHandlers;
	posts: PostHandlers;
}
// no auth needed: a new device asks for a pairing code and waits for it to be approved
const PUBLIC: PostPath[] = ['pair', 'pair/poll'];

const json = (res: ServerResponse, code: number, v: unknown) => {
	res.writeHead(code, { 'content-type': 'application/json' });
	res.end(JSON.stringify(v));
};
async function body(req: IncomingMessage): Promise<unknown> {
	let s = '';
	for await (const c of req) s += c;
	return s ? JSON.parse(s) : {};
}
const header = (req: IncomingMessage, name: string) => {
	const v = req.headers[name];
	return Array.isArray(v) ? v[0] : v;
};

/** an error as the person reads it: ours in their language, anything else as it came */
function errorFor(req: IncomingMessage, err: unknown) {
	if (!(err instanceof UserError)) return errMsg(err);
	const lang = profileOf(header(req, 'x-profile')).lang || header(req, 'x-lang') || 'fr';
	return i18nFor(lang)._(err.descriptor);
}

// --- first start (no Real-Debrid token yet): the setup screen, opened with the one-time link
// from the log / installer; afterwards the settings screen, for paired devices ---
const publicUrl = (req: IncomingMessage) => process.env.PUBLIC_URL || `${isHttps(req.headers) ? 'https' : 'http'}://${req.headers.host}`;
type Req = IncomingMessage;
type Res = ServerResponse;
async function settings(req: Req, res: Res, where: string, setupOk: boolean) {
	if (where === '/api/settings/storage') {
		const reply: GetRoutes['settings/storage']['reply'] = await storage();
		return json(res, 200, reply);
	}
	if (req.method === 'GET') {
		const reply: GetRoutes['settings']['reply'] = {
			update: updateInfo(),
			values: settingsView(),
			url: publicUrl(req),
		};
		return json(res, 200, reply);
	}
	// the bodies of these routes (PostRoutes['settings' | 'settings/check' | 'settings/update' |
	// 'settings/lg']), read field by field
	const b = await body(req) as Partial<Record<string, unknown>>;
	const values = (b.values ?? {}) as Record<string, unknown>;
	if (where === '/api/settings/check') {
		const reply: PostRoutes['settings/check']['reply'] = await check(String(b.name), values);
		return json(res, 200, reply);
	}
	if (where === '/api/settings/update') {
		requestUpdate(b.what === 'tv' ? 'tv' : 'update');
		return json(res, 200, updateInfo());
	}
	if (where === '/api/settings/lg') {
		await installOnTv(String(b.host ?? '').trim(), String(b.code ?? '').trim());
		const reply: PostRoutes['settings/lg']['reply'] = { ok: true };
		return json(res, 200, reply);
	}
	saveSettings(values);
	if (setupOk) res.setHeader('set-cookie', cookie(req.headers)); // the device that did the setup is the first one paired
	const reply: PostRoutes['settings']['reply'] = { restart: true };
	json(res, 200, reply);
	console.log('settings saved, restarting');
	setTimeout(() => process.exit(0), 300); // every module reads its settings at start
}
async function setupOrSettings(req: IncomingMessage, res: ServerResponse, where: string) {
	const setupOk = !configured() && header(req, 'x-setup') === setupToken();
	if (where === '/api/setup') {
		// readable from any page: the setup screen asks it of the public address, from wherever it
		// was opened, to see that Player1 answers there
		res.setHeader('access-control-allow-origin', '*');
		const reply: GetRoutes['setup']['reply'] = {
			needed: !configured(),
			ok: setupOk,
		};
		return json(res, 200, reply);
	}
	const error = configured() ? 'unpaired' : 'setup';
	if (!setupOk && !authed(req.headers)) return json(res, 401, { error });
	try {
		await settings(req, res, where, setupOk);
	} catch (err) {
		json(res, 500, { error: errorFor(req, err) });
	}
}

// a device searching its network (the LG TV app) asks every address this; the answer names the
// address to use from then on: the public one when it's set, else the one that was just reached
function here(req: IncomingMessage, res: ServerResponse) {
	res.setHeader('access-control-allow-origin', '*');
	const reply: GetRoutes['here']['reply'] = {
		app: 'player1',
		url: publicUrl(req).replace(/\/$/, ''),
	};
	json(res, 200, reply);
}

// --- the API ---
const handlerOf = (
	gets: Record<string, Handler | undefined>,
	posts: Record<string, Handler | undefined>,
	method = '',
	name = '',
) => {
	const map = {
		GET: gets, POST: posts, 
	}[method];
	return map && Object.hasOwn(map, name) ? map[name] : undefined;
};

async function run(fn: Handler, req: Req, res: Res, q: Record<string, string>) {
	const profile = profileOf(header(req, 'x-profile')), lang = header(req, 'x-lang');
	try {
		// the query or body as the route declares it: a paired device, or the pairing screen
		const input = (req.method === 'POST' ? await body(req) : q) as never;
		const reply = await request.run({
			profile,
			lang,
		}, () => fn(input, {
			req,
			res,
		}));
		json(res, 200, reply);
	} catch (err) {
		console.error(req.url, errMsg(err));
		json(res, 500, { error: errorFor(req, err) });
	}
}

async function api(
	req: IncomingMessage,
	res: ServerResponse,
	u: URL,
	routes: Routes,
) {
	const where = u.pathname, q = Object.fromEntries(u.searchParams);
	if (where === '/api/here') return here(req, res);
	const setup = where.startsWith('/api/settings') || where === '/api/setup';
	if (setup) return setupOrSettings(req, res, where);
	if (!configured()) return json(res, 503, { error: 'setup' });
	const name = where.slice('/api/'.length);
	const pub = req.method === 'POST' && (PUBLIC as string[]).includes(name);
	if (!pub && !authed(req.headers)) return json(res, 401, { error: 'unpaired' });
	if (where === '/api/events') return events(req, res, q);
	const trailer = trailerPath(/^\/api\/trailers\/([\w-]+)\.mp4$/.exec(where)?.[1] ?? '');
	if (trailer) {
		return sendRange(req, res, trailer, 'video/mp4', 'private, max-age=86400')
			.catch(() => res.writeHead(404).end());
	}
	if (/^\/api\/(wb)?file\//.test(where)) return relay(req, u, res).catch((err: unknown) => {
		console.error(where, errMsg(err));
		if (!res.headersSent) res.writeHead(502);
		res.end();
	});
	const fn = handlerOf(routes.gets, routes.posts, req.method, name);
	if (!fn) return json(res, 404, { error: 'not found' });
	return run(fn, req, res, q);
}

// --- files ---
// the web app's build sits next to this file (data/app/web in production)
const WEB = fileURLToPath(new URL('./web/', import.meta.url));
const TYPES: Record<string, string> = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.woff2': 'font/woff2',
	'.json': 'application/json',
	'.webmanifest': 'application/manifest+json',
};
const typeOf = (file: string) => TYPES[path.extname(file)] ?? 'application/octet-stream';
const isFile = async (file: string) => !!(await fs.promises.stat(file).catch(() => null))?.isFile();
const READY = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="refresh" content="5"><title>Player1</title><body style="background:#17121f;color:#eee;font:16px system-ui;display:grid;place-items:center;height:100vh;margin:0">Player1 is getting ready…</body>';

function sendFile(res: ServerResponse, file: string, cache: string) {
	res.writeHead(200, {
		'content-type': typeOf(file),
		'cache-control': cache,
	});
	fs.createReadStream(file).on('error', () => res.end()).pipe(res);
}
// a file of the build, else index.html: the app routes every other address itself
async function webApp(res: ServerResponse, u: URL) {
	let file = '';
	try {
		file = path.join(WEB, decodeURIComponent(u.pathname));
	} catch { /* a malformed address gets the app */ }
	if (file.startsWith(WEB) && file !== WEB && await isFile(file)) {
		const immutable = u.pathname.startsWith('/assets/'); // the build names them by their content
		return sendFile(res, file, immutable ? 'public, max-age=31536000, immutable' : 'no-cache');
	}
	const index = path.join(WEB, 'index.html');
	if (await isFile(index)) return sendFile(res, index, 'no-cache');
	// the web app isn't built yet (an update in progress)
	res.writeHead(200, {
		'content-type': 'text/html; charset=utf-8',
		'cache-control': 'no-store',
	});
	res.end(READY);
}

const apkVersion = (res: ServerResponse) => {
	let version = 0;
	try {
		version = +fs.readFileSync(`${DATA}/dist/version`, 'utf8');
	} catch { /* not built yet */ }
	json(res, 200, { version });
};
// app icons: public, the pairing screen shows them too
function icon(res: ServerResponse, [, name = '', ext]: string[]) {
	res.writeHead(200, {
		'content-type': ext === 'svg' ? 'image/svg+xml' : 'image/png',
		'cache-control': 'public, max-age=86400',
	});
	fs.createReadStream(path.resolve('packages/web/icons', name))
		.on('error', () => res.end())
		.pipe(res);
}
// the device test's clips (samples.ts): their list, then each one; ranged: the player reads the .mkv in pieces
async function sample(req: Req, res: Res, [, name = '']: string[]) {
	if (!await clipsReady()) {
		void fetchClips(); // not all here (the fetch at the start failed?): tried again, the test can't run yet
		return res.writeHead(404).end();
	}
	if (name === 'index.json') return json(res, 200, CLIPS);
	return sendRange(req, res, path.join(SAMPLES, name), 'video/x-matroska');
}
const MANIFEST = JSON.stringify({
	name: 'Player1',
	short_name: 'Player1',
	start_url: '/',
	display: 'standalone',
	background_color: '#17121f',
	theme_color: '#17121f',
	icons: [
		{
			src: '/icons/icon-192.png?v=2',
			sizes: '192x192',
			type: 'image/png',
		},
		{
			src: '/icons/icon-512.png?v=2',
			sizes: '512x512',
			type: 'image/png',
		},
		{
			src: '/icons/maskable-512.png?v=2',
			sizes: '512x512',
			type: 'image/png',
			purpose: 'maskable',
		},
	],
});
const manifest = (res: Res) => {
	res.writeHead(200, { 'content-type': 'application/manifest+json' }).end(MANIFEST);
};
// Android TV app; holds no secret, pairing happens on first launch
function apk(res: ServerResponse) {
	res.writeHead(200, {
		'content-type': 'application/vnd.android.package-archive',
		'content-disposition': 'attachment; filename="player1.apk"',
	});
	// built by run.mjs (tv/build.mjs)
	fs.createReadStream(`${DATA}/dist/player1.apk`).on('error', () => res.end()).pipe(res);
}
// LG TV (webOS) app: a launcher for this site, built by run.mjs (webos/build.mjs) with the Homebrew Channel
// repository that lists it (read by the Homebrew Channel app on the TV, hence any origin)
function webos(res: ServerResponse, name: 'player1.ipk' | 'repo.json') {
	const file = `${DATA}/webos/${name}`;
	const size = fs.statSync(file, { throwIfNoEntry: false })?.size;
	if (!size) return res.writeHead(404).end();
	res.writeHead(200, {
		'content-length': size,
		'cache-control': 'no-cache',
		...name === 'repo.json'
			? {
				'content-type': 'application/json; charset=utf-8',
				'access-control-allow-origin': '*',
			}
			: {
				'content-type': 'application/vnd.webos.ipk',
				'content-disposition': 'attachment; filename="player1.ipk"',
			},
	});
	fs.createReadStream(file).on('error', () => res.end()).pipe(res);
}

// the files anyone may fetch, and the web app; false when it's an API call
async function files(req: IncomingMessage, res: ServerResponse, u: URL) {
	const where = u.pathname;
	const iconAt = /^\/icons\/([\w-]+\.(svg|png))$/.exec(where);
	const sampleAt = /^\/samples\/(index\.json|[\w-]+\.mkv)$/.exec(where);
	if (where === '/apk-version') apkVersion(res);
	else if (iconAt) icon(res, iconAt);
	else if (sampleAt && authed(req.headers)) await sample(req, res, sampleAt);
	else if (where === '/manifest.webmanifest') manifest(res);
	else if (where === '/player1.apk' || where === '/tv') apk(res);
	else if (where === '/player1.ipk' || where === '/webos') webos(res, 'player1.ipk');
	else if (where === '/webos.json') webos(res, 'repo.json');
	else if (where.startsWith('/api/')) return false;
	else if (u.searchParams.get('key')) { // one-time login link: /?key=ACCESS_KEY
		res.writeHead(302, {
			'set-cookie': cookie(req.headers, u.searchParams.get('key') ?? ''),
			location: '/',
		}).end();
	} else await webApp(res, u);
	return true;
}

export const handler = (routes: Routes) => async (req: Req, res: Res) => {
	const u = new URL(req.url ?? '/', 'http://x');
	try {
		if (!await files(req, res, u)) await api(req, res, u, routes);
	} catch (err) {
		console.error(req.url, errMsg(err));
		if (!res.headersSent) json(res, 500, { error: errMsg(err) });
		else res.end();
	}
};
