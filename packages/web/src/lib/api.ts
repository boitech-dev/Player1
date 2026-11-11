import { t } from '@lingui/core/macro';

import {
	type GetPath,
	type GetRoutes,
	HEADERS,
	type PostPath,
	type PostRoutes,
} from '@player1/shared/api';

import { uiLang } from './i18n.ts';
import {
	load,
	setupToken,
} from './store.ts';

export class ApiError extends Error {
	constructor(message: string, readonly status: number) {
		super(message);
	}
}

const wait = (ms: number) => new Promise(ok => setTimeout(ok, ms));

// A reply that isn't ours (the proxy's error page while the server restarts, a dropped
// connection) is retried a few times, then reported in plain words, never as raw HTML.
async function call<T>(path: string, init: RequestInit, tries = 4): Promise<T> {
	const headers: Record<string, string> = {
		[HEADERS.profile]: load('profile') ?? '',
		[HEADERS.setup]: setupToken(),
		[HEADERS.lang]: uiLang(),
		...init.headers as Record<string, string>,
	};
	const r = await fetch('/api/' + path, {
		...init,
		headers,
	}).catch(() => null);
	const ours = r && /json/.test(r.headers.get('content-type') ?? '');
	const j = ours ? await r.json().catch(() => null) as unknown : null;
	if (!r || !j) {
		if (tries > 1) {
			await wait(1500);
			return call(path, init, tries - 1);
		}
		throw new ApiError(t`The server isn’t answering right now. Try again in a moment.`, r?.status ?? 0);
	}
	if (!r.ok) throw new ApiError((j as { error?: string }).error ?? String(r.status), r.status);
	return j as T;
}

type Query = Record<string, string | number | undefined | null>;

/** a GET route, its query as a query string */
export function get<P extends GetPath>(
	path: P,
	...query: GetRoutes[P]['query'] extends void ? [] : [GetRoutes[P]['query']]
): Promise<GetRoutes[P]['reply']> {
	const q = Object.entries((query[0] ?? {}) as Query)
		.filter(([, v]) => v != null && v !== '')
		.map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
		.join('&');
	return call(path + (q ? '?' + q : ''), {});
}

/** a POST route, its body as JSON */
export function post<P extends PostPath>(
	path: P,
	body: PostRoutes[P]['body'],
): Promise<PostRoutes[P]['reply']> {
	return call(path, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body),
	});
}

/** whether the server answers at all (after a restart) */
export const alive = () => fetch('/api/setup').then(r => r.ok, () => false);
