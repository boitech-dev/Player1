// Updates: run.mjs installs them, data/update.json says how it went, and it builds the TV app.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

import type {
	UpdateInfo,
	UpdateStatus,
} from '@player1/shared/api';

import { DATA } from './config.ts';

const VERSION = (() => {
	try {
		return execFileSync('git', ['log', '-1', '--format=%h %cI'], {
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'ignore'],
		}).trim().split(' ');
	} catch {
		return [];
	}
})();

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
