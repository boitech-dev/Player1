// Devices: every open client holds an SSE stream; "send" pushes a play request to one. Pairing:
// a new device shows a code, an already logged-in device types it in to let it in.
import crypto from 'node:crypto';
import type {
	IncomingMessage,
	ServerResponse,
} from 'node:http';

import { msg } from '@lingui/core/macro';

import type { DeviceMessage } from '@player1/shared/api';

import { cookie } from './cookie.ts';
import {
	activePreset,
	profileOf,
} from './db.ts';
import type {
	GetHandlers,
	PostHandlers,
} from './http.ts';
import { UserError } from './i18n.ts';

interface Online {
	name: string;
	ua?: string;
	res: ServerResponse;
	profile: string;
}
const devices = new Map<string, Online>();

const sse = (res: ServerResponse, m: DeviceMessage) => res.write(`data: ${JSON.stringify(m)}\n\n`);
export const broadcast = (m: DeviceMessage, profile?: string) => {
	for (const d of devices.values()) if (!profile || d.profile === profile) sse(d.res, m);
};
// keep proxies from closing idle SSE
export const ping = () => {
	for (const d of devices.values()) d.res.write(': ping\n\n');
};

export function events(req: IncomingMessage, res: ServerResponse, q: Record<string, string>) {
	res.writeHead(200, {
		'content-type': 'text/event-stream',
		'cache-control': 'no-cache, no-transform',
		'x-accel-buffering': 'no',
	});
	const P = profileOf(q.profile), id = q.id ?? 'undefined';
	sse(res, { preset: activePreset(P).id });
	const name = q.name || 'Appareil', ua = req.headers['user-agent'];
	for (const [other, d] of devices) if (other !== id && d.name === name && d.ua === ua) { // same device, new id: keep one entry
		d.res.end();
		devices.delete(other);
	}
	devices.set(id, {
		name,
		ua,
		res,
		profile: P.id,
	});
	// tells which browser/WebView version each TV runs
	console.log('device online:', q.name, q.screen, 'hw:' + (q.hw || 'h264 only'), '|', ua);
	req.on('close', () => devices.get(id)?.res === res && devices.delete(id));
}

// --- pairing ---
const pairs = new Map<string, { secret: string; name: string; ok?: boolean; t: number }>();

export const deviceGets: GetHandlers = {
	devices: () => [...devices].map(([id, d]) => ({
		id,
		name: d.name,
	})),
};

export const devicePosts: PostHandlers = {
	send: ({ to, play }) => {
		const d = devices.get(to);
		if (!d) throw new UserError(msg`This device is no longer connected`);
		sse(d.res, { play });
		return {};
	},
	'pair': ({ name }) => {
		for (const [c, p] of pairs) if (p.t < Date.now() - 600e3) pairs.delete(c);
		if (pairs.size > 100) throw new UserError(msg`Too many devices are waiting to be connected. Try again in a few minutes.`);
		let code;
		do code = String(crypto.randomInt(1e6)).padStart(6, '0'); while (pairs.has(code));
		const secret = crypto.randomBytes(16).toString('hex');
		pairs.set(code, {
			secret,
			name: String(name || 'Appareil').slice(0, 40),
			t: Date.now(),
		});
		return {
			code,
			secret,
		};
	},
	'pair/poll': ({ secret }, { req, res }) => {
		const [code, p] = [...pairs].find(([, x]) => x.secret === secret) ?? [];
		if (!code || !p) throw new UserError(msg`This code has expired`);
		if (!p.ok) return { ok: false };
		pairs.delete(code);
		res.setHeader('set-cookie', cookie(req.headers));
		return { ok: true };
	},
	'pair/approve': ({ code }) => {
		const p = pairs.get(String(code || '').replace(/\D/g, ''));
		if (!p) throw new UserError(msg`This code is wrong or has expired`);
		p.ok = true;
		return { name: p.name };
	},
};
