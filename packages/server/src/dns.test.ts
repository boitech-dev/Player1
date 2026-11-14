import dns from 'node:dns';

import {
	expect,
	it,
} from 'vitest';

import { publicFirst } from './dns.ts';

// this machine's usual lookup, as a French ISP's would answer: the router's own names, and a blocked site sent nowhere
const usual = ((host: string, _o: unknown, cb: (e: null, a: string, f: number) => void) =>
	cb(null, host === 'jellyfin.lan' ? '192.168.1.148' : '0.0.0.0', 4)) as unknown as typeof dns.lookup;
const find = (host: string) => new Promise<string>((ok, ko) =>
	publicFirst(usual)(host, {}, (err, address) => err ? ko(err) : ok(address as string)));

it('asks the public resolver first, the usual lookup for names it does not know', async () => {
	expect(await find('c411.org')).not.toBe('0.0.0.0');
	expect(await find('jellyfin.lan')).toBe('192.168.1.148');
});
