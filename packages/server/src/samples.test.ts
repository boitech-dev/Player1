import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';

import {
	describe,
	expect,
	it,
} from 'vitest';

import {
	type Clip,
	clipsReady,
	fetchClips,
} from './samples.ts';

describe('the device test clips', () => {
	it('are fetched when missing, and kept only when they are the expected file', async () => {
		const good = Buffer.from('eight seconds of film');
		const server = http.createServer((req, res) => res.end(req.url === '/h264.mkv' ? good : 'no'))
			.listen(0);
		const from = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clips-'));
		const clip = (key: Clip['key'], buf: Buffer): Clip => ({
			key,
			name: key,
			codec: '',
			width: 0,
			height: 0,
			fps: 24,
			bytes: buf.length,
			sha256: crypto.createHash('sha256').update(buf).digest('hex'),
		});
		try {
			const one = [clip('h264', good)];
			expect(await clipsReady(dir, one)).toBe(false);
			await fetchClips(dir, one, from);
			expect(await clipsReady(dir, one)).toBe(true);
			// another version of the clip: the file here is not it, and neither is what the address gives
			const two = [clip('h264', Buffer.from('eight seconds of another film'))];
			expect(await clipsReady(dir, two)).toBe(false);
			await fetchClips(dir, two, from);
			expect(await clipsReady(dir, two)).toBe(false);
			expect(fs.readdirSync(dir)).toEqual(['h264.mkv']);
		} finally {
			server.close();
			fs.rmSync(dir, { recursive: true });
		}
	});
});
