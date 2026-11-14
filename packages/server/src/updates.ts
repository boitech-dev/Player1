// Updates: run.mjs installs them, data/update.json says how it went, and it builds the TV app.
// Also what this server runs and what it keeps on its disks, for the settings page.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import type {
	DiskInfo,
	StorageReply,
	StorageUse,
	UpdateInfo,
	UpdateStatus,
} from '@player1/shared/api';

import { DATA } from './config.ts';
import { MEDIA } from './sources.ts';

const git = (...args: string[]) => {
	try {
		return execFileSync('git', args, {
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'ignore'],
		}).trim().split(' ');
	} catch {
		return [];
	}
};
const VERSION = git('log', '-1', '--format=%h %cI');
// release/publish.sh makes each public release one commit, "release version X"; tags don't reach every
// install (git fetch only follows the branch), the commit always does, also into master after it
const RELEASE = git('log', '-1', '--grep=^release version ', '--format=%h %s');

interface UpdateFile {
	status?: UpdateStatus;
	error?: string | null;
	checked?: number;
	head?: string;
	latest?: string;
	tv?: UpdateInfo['tv'];
	tvError?: string | null;
	supervised?: boolean;
}
const readJSON = <T>(file: string): Partial<T> => {
	try {
		return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
	} catch {
		return {};
	}
};

export const updateInfo = (): UpdateInfo => {
	const u = readJSON<UpdateFile>(`${DATA}/update.json`);
	const tv = readJSON<{ version: number }>(`${DATA}/dist/build.json`);
	return {
		commit: VERSION[0],
		date: VERSION[1],
		version: RELEASE[3],
		release: !!RELEASE[0] && RELEASE[0] === VERSION[0],
		status: u.status,
		error: u.error,
		checked: u.checked,
		behind: u.latest ? u.latest !== u.head : undefined,
		tv: u.tv,
		tvError: u.tvError,
		tvVersion: tv.version,
		supervised: !!u.supervised,
	};
};

// run.mjs picks the request up: a full update, or only a new build of the TV app
export const requestUpdate = (what: 'update' | 'tv') => {
	fs.writeFileSync(`${DATA}/update.request`, what);
};

// --- disk space ---

/** data/'s folders and files, by what they are; anything else is 'other' */
const KIND: Record<string, StorageUse> = {
	'trailers': 'trailers',
	'samples': 'samples',
	'runtime': 'tools',
	'bin': 'tools',
	'npm-cache': 'tools',
	'app': 'builds',
	'app.prev': 'builds',
	'stage': 'builds',
	'stage-data': 'builds',
	'dist': 'tv',
	'dist.prev': 'tv',
	'webos': 'tv',
	'tv.keystore': 'tv',
	'config.json': 'household',
};
const kindOf = (name: string): StorageUse =>
	KIND[name] ?? (/^db\b.*\.json$/.test(name) ? 'household' : 'other');

/** room taken on the disk (du's count, not file sizes), symbolic links not followed */
async function du(p: string): Promise<number> {
	const st = await fs.promises.lstat(p).catch(() => null);
	if (!st) return 0;
	if (!st.isDirectory()) return st.blocks * 512;
	const names = await fs.promises.readdir(p).catch(() => []);
	const sizes = await Promise.all(names.map(n => du(path.join(p, n))));
	return sizes.reduce((a, b) => a + b, st.blocks * 512);
}

export async function storage(): Promise<StorageReply> {
	const sum = new Map<StorageUse, number>();
	const add = (what: StorageUse, n: number) => sum.set(what, (sum.get(what) ?? 0) + n);
	const names = await fs.promises.readdir(DATA).catch(() => []);
	await Promise.all(names.map(async n => add(kindOf(n), await du(path.join(DATA, n)))));
	const downloads = MEDIA ? await du(`${MEDIA}/player1`) : 0;
	if (downloads) add('downloads', downloads);

	// one line per disk: the data folder's, and the library's when it's another one
	const disks: (DiskInfo & { dev: number })[] = [];
	const data = [...sum.values()].reduce((a, b) => a + b, 0) - downloads;
	const places = [['data', DATA, data], ['library', MEDIA, downloads]] as const;
	for (const [holds, dir, player1] of places) {
		if (!dir) continue;
		const [st, fsys] = await Promise.all([fs.promises.stat(dir), fs.promises.statfs(dir)])
			.catch(() => []);
		if (!st || !fsys) continue;
		const same = disks.find(d => d.dev === st.dev);
		if (same) {
			same.holds.push(holds);
			same.player1 += player1;
			continue;
		}
		disks.push({
			dev: st.dev,
			path: path.resolve(dir),
			size: fsys.blocks * fsys.bsize,
			free: fsys.bavail * fsys.bsize,
			player1,
			holds: [holds],
		});
	}
	return {
		disks: disks.map(({ dev: _, ...d }) => d),
		used: [...sum].map(([what, bytes]) => ({
			what,
			bytes,
		})).filter(u => u.bytes).sort((a, b) => b.bytes - a.bytes),
	};
}
