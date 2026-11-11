// The device test's clips: 8 seconds of Sol Levante (© Netflix, CC BY 4.0) in each format a device is
// tested on. packages/server/make-samples.mjs encoded them once; they are published as release files, and each
// server fetches them into data/samples/ when it starts. Nothing here reads or converts video.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type { TestClip } from '@player1/shared/release';

import { DATA } from './config.ts';

export const SAMPLES = path.join(DATA, 'samples');
const FROM = 'https://github.com/boitech-dev/Player1/releases/download/samples-1/';

export interface Clip extends TestClip {
	bytes: number;
	sha256: string;
}

/** as make-samples.mjs printed them */
export const CLIPS: Clip[] = [
	{
		key: 'h264',
		name: 'H.264 1080p, débit Blu-ray',
		codec: 'avc1.640029',
		width: 1920,
		height: 1080,
		fps: 24,
		bytes: 31381185,
		sha256: '0f29ec3d80095e63e3b280c5b7d7b9a0a840096f226f1749ae65a80e994732f2',
	},
	{
		key: 'hevc10',
		name: 'HEVC 10 bits 1080p',
		codec: 'hvc1.2.4.L120.90',
		width: 1920,
		height: 1080,
		fps: 24,
		bytes: 7247586,
		sha256: '2f1ed8e342c632e0fe1828dde7cdbcff9e1d67c3f2bf133da780ac5ffd881425',
	},
	{
		key: '4k',
		name: 'HEVC 10 bits 4K HDR',
		codec: 'hvc1.2.4.L153.90',
		width: 3840,
		height: 2160,
		fps: 24,
		bytes: 21645584,
		sha256: '207b0ff98e4ccde029f2b2bba18e98fe1e7434e41ed9c6f9e9dc27e199f8adb6',
	},
	{
		key: 'av1',
		name: 'AV1 1080p',
		codec: 'av01.0.08M.10',
		width: 1920,
		height: 1080,
		fps: 24,
		bytes: 4089830,
		sha256: '72eae7ebebe73a97600d46425262ea6e65df51b63ca4c54995d974f940f21e1a',
	},
];

const fileOf = (dir: string, c: Clip) => path.join(dir, `${c.key}.mkv`);
// a clip of another size is another version's: fetched again
const has = async (dir: string, c: Clip) =>
	(await fs.promises.stat(fileOf(dir, c)).catch(() => null))?.size === c.bytes;

/** whether every clip is here: the test runs on all of them or not at all */
export const clipsReady = async (dir = SAMPLES, clips = CLIPS) =>
	(await Promise.all(clips.map(c => has(dir, c)))).every(Boolean);

async function fetchClip(dir: string, c: Clip, from: string) {
	const r = await fetch(`${from}${c.key}.mkv`);
	if (!r.ok) throw new Error(`${c.key}: HTTP ${r.status}`);
	// ponytail: a clip is held in memory while it is fetched (30 MB at most); stream it if clips grow
	const buf = Buffer.from(await r.arrayBuffer());
	const sum = crypto.createHash('sha256').update(buf).digest('hex');
	if (sum !== c.sha256) throw new Error(`${c.key}: not the expected file`);
	await fs.promises.writeFile(`${fileOf(dir, c)}.part`, buf);
	await fs.promises.rename(`${fileOf(dir, c)}.part`, fileOf(dir, c)); // whole, or not there
}

let fetching: Promise<void> | null = null;
/** fetches the clips that are missing, once at a time; a failure is logged and tried again at the next call */
export function fetchClips(dir = SAMPLES, clips = CLIPS, from = FROM) {
	fetching ??= (async () => {
		await fs.promises.mkdir(dir, { recursive: true });
		for (const c of clips) if (!await has(dir, c)) await fetchClip(dir, c, from);
	})().catch((err: unknown) => console.error('device test clips:', String(err))).finally(() => {
		fetching = null;
	});
	return fetching;
}
