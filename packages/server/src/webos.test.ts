import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

import {
	expect,
	it,
} from 'vitest';

// the LG TV package as webos/build.mjs writes it: an ar archive of three members, the app inside
// data.tar.gz, and a Homebrew Channel repository that names this exact file
it('builds an installable LG TV package and its repository', () => {
	const out = fs.mkdtempSync(path.join(os.tmpdir(), 'p1-webos-'));
	const root = path.resolve(import.meta.dirname, '../../..');
	execFileSync(process.execPath, [`${root}/webos/build.mjs`, out], {
		env: {
			...process.env,
			PUBLIC_URL: 'http://tv.test:6510/',
		},
	});
	const ipk = fs.readFileSync(`${out}/player1.ipk`);
	const info = JSON.parse(fs.readFileSync(`${root}/webos/appinfo.json`, 'utf8')) as {
		id: string;
		version: string;
	};

	expect(ipk.subarray(0, 8).toString()).toBe('!<arch>\n');
	const members = new Map<string, Buffer>();
	for (let at = 8; at < ipk.length;) {
		const size = +ipk.subarray(at + 48, at + 58).toString();
		members.set(ipk.subarray(at, at + 16).toString().trim(), ipk.subarray(at + 60, at + 60 + size));
		at += 60 + size + size % 2;
	}
	expect([...members.keys()]).toEqual(['debian-binary', 'control.tar.gz', 'data.tar.gz']);
	const control = zlib.gunzipSync(members.get('control.tar.gz')!).toString();
	expect(control).toContain(`Package: ${info.id}\nVersion: ${info.version}\n`);
	const data = zlib.gunzipSync(members.get('data.tar.gz')!).toString('latin1');
	for (const f of ['appinfo.json', 'index.html', 'icon.png', 'largeIcon.png']) {
		expect(data).toContain(`usr/palm/applications/${info.id}/${f}`);
	}
	expect(data).toContain('var BUILT = \'http://tv.test:6510\'');

	const repo = JSON.parse(fs.readFileSync(`${out}/repo.json`, 'utf8')) as {
		packages: { id: string; manifest: unknown }[];
	};
	expect(repo.packages).toHaveLength(1);
	expect(repo.packages[0]).toMatchObject({
		id: info.id,
		manifest: {
			version: info.version,
			ipkUrl: '/player1.ipk',
			ipkSize: ipk.length,
			ipkHash: { sha256: createHash('sha256').update(ipk).digest('hex') },
		},
	});
	fs.rmSync(out, { recursive: true });
});
