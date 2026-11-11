// The login cookie of paired devices: the access key, kept ten years. Pure: tested on its own.
import crypto from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';

// Secure only over https: a plain-http LAN install (http://192.168.x.x:6510) would otherwise
// never keep its login
export const isHttps = (h: IncomingHttpHeaders, publicUrl = process.env.PUBLIC_URL || '') => {
	const proto = String(h['x-forwarded-proto'] || '');
	return proto.startsWith('https') || publicUrl.startsWith(`https://${h.host}`);
};

export const cookie = (h: IncomingHttpHeaders, key = process.env.ACCESS_KEY || '') => {
	const secure = isHttps(h) ? '; Secure' : '';
	return `k=${encodeURIComponent(key)}; Path=/; Max-Age=315360000; HttpOnly; SameSite=Lax${secure}`;
};

const sha = (s: string) => crypto.createHash('sha256').update(s).digest();
const keyOf = (h: IncomingHttpHeaders) => {
	const k = /(?:^|; )k=([^;]+)/.exec(h.cookie || '')?.[1];
	try {
		return k && decodeURIComponent(k);
	} catch {
		return undefined;
	}
};
export const authed = (h: IncomingHttpHeaders, key = process.env.ACCESS_KEY || '') => {
	const k = keyOf(h);
	return !!k && !!key && crypto.timingSafeEqual(sha(k), sha(key));
};
