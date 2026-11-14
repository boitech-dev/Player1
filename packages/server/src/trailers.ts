// Trailers as files. YouTube's own player is slow to show (its buttons stay up 4 s after it starts)
// and fails in places, so the server also fetches each trailer with yt-dlp: the best H.264 video and
// AAC audio, joined into one MP4 by copying (nothing is re-encoded). The page plays whichever of the
// two is ready first. Files stay in data/trailers/ until unused for 30 days.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

import { DATA } from './config.ts';
import { errMsg } from './upstream.ts';

const exec = promisify(execFile);
const TRAILERS = path.join(DATA, 'trailers');
const BIN = path.join(DATA, 'bin', 'yt-dlp');
const KEY = /^[\w-]{11}$/;
const MONTH = 30 * 864e5;

/** where a YouTube video's trailer file is, once fetched */
export const trailerPath = (key: string) =>
	KEY.test(key) ? path.join(TRAILERS, `${key}.mp4`) : null;

// yt-dlp's standalone build (no Python needed), fetched the first time
let tool: Promise<string> | undefined;
const ytdlp = () => tool ??= (async () => {
	if (!fs.existsSync(BIN)) {
		const arch = process.arch === 'arm64' ? '_aarch64' : '';
		const r = await fetch(`https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux${arch}`);
		if (!r.ok) throw new Error(`yt-dlp download: ${r.status}`);
		await fs.promises.mkdir(path.dirname(BIN), { recursive: true });
		await fs.promises.writeFile(`${BIN}.part`, Buffer.from(await r.arrayBuffer()), { mode: 0o755 });
		await fs.promises.rename(`${BIN}.part`, BIN);
	}
	return BIN;
})().catch((err: unknown) => {
	tool = undefined; // tried again next time
	throw err;
});

// ponytail: two fetches at a time, first come first served; a hover that moves on still gets fetched
let running = 0;
const waiting: (() => void)[] = [];
async function turn<T>(f: () => Promise<T>) {
	if (running >= 2) await new Promise<void>(go => waiting.push(go));
	running++;
	try {
		return await f();
	} finally {
		running--;
		waiting.shift()?.();
	}
}

async function fetchTrailer(key: string, file: string) {
	if (!fs.existsSync(file)) {
		const bin = await ytdlp();
		await fs.promises.mkdir(TRAILERS, { recursive: true });
		await turn(() => exec(bin, [
			'--js-runtimes', 'node',
			'-f', 'bv*[height<=1080][vcodec^=avc1]+ba[acodec^=mp4a]/b[ext=mp4]',
			'--merge-output-format', 'mp4',
			'--postprocessor-args', 'Merger+ffmpeg:-movflags +faststart', // playable before it's all loaded
			'--no-playlist', '--quiet', '--no-warnings',
			'-o', path.join(TRAILERS, '%(id)s.%(ext)s'),
			`https://www.youtube.com/watch?v=${key}`,
		], { timeout: 180e3 }));
	}
	const now = new Date();
	await fs.promises.utimes(file, now, now); // used: kept another 30 days
	const { stdout } = await exec('ffprobe', [
		'-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=height', '-of', 'csv=p=0', file,
	]);
	return +stdout.trim() || 0;
}

const fetching = new Map<string, Promise<number>>();
/** a YouTube video as a file here, fetched if need be: its height, 0 when YouTube won't give it */
export function trailerFile(key: string): Promise<number> {
	const file = trailerPath(key);
	if (!file) return Promise.resolve(0);
	let p = fetching.get(key);
	if (!p) {
		p = fetchTrailer(key, file)
			.catch((err: unknown) => {
				console.error('trailer', key, errMsg(err));
				return 0;
			})
			.finally(() => fetching.delete(key));
		fetching.set(key, p);
	}
	return p;
}

/** daily: trailers unused for 30 days go (half-fetched leftovers too), and yt-dlp updates itself, as
 *  YouTube changes often */
export async function sweepTrailers() {
	for (const name of await fs.promises.readdir(TRAILERS).catch(() => [])) {
		const file = path.join(TRAILERS, name);
		const { mtimeMs } = await fs.promises.stat(file);
		if (Date.now() - mtimeMs > MONTH) await fs.promises.rm(file, { force: true });
	}
	if (fs.existsSync(BIN)) await exec(BIN, ['-U'], { timeout: 120e3 }).catch(() => {});
}
