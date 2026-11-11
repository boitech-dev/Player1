import {
	describe,
	expect,
	it,
} from 'vitest';

import {
	authed,
	cookie,
	isHttps,
} from './cookie.ts';

describe('the login cookie', () => {
	it('is Secure only when the page came over https', () => {
		expect(isHttps({ 'x-forwarded-proto': 'https' })).toBe(true);
		expect(isHttps({ host: 'p1.example.org' }, 'https://p1.example.org')).toBe(true);
		expect(isHttps({ host: '192.168.1.5:6510' }, 'https://p1.example.org')).toBe(false);
		expect(isHttps({ host: '192.168.1.5:6510' }, '')).toBe(false);
		expect(cookie({ 'x-forwarded-proto': 'https' }, 'a b'))
			.toBe('k=a%20b; Path=/; Max-Age=315360000; HttpOnly; SameSite=Lax; Secure');
		expect(cookie({ host: 'x' }, 'k')).not.toContain('Secure');
	});
	it('lets in only the access key', () => {
		expect(authed({ cookie: 'x=1; k=a%20b' }, 'a b')).toBe(true);
		expect(authed({ cookie: 'k=nope' }, 'a b')).toBe(false);
		expect(authed({ cookie: 'k=%E0' }, 'a b')).toBe(false);
		expect(authed({}, 'a b')).toBe(false);
		expect(authed({ cookie: 'k=' }, '')).toBe(false);
	});
});
