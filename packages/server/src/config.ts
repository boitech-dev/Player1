// Settings: data/config.json, written by the setup and settings screens. A value set in the
// environment (.env) wins and shows as read-only. Imported first by main.ts and merged into
// process.env, so every module just reads process.env. Changing a setting restarts the server
// (run.mjs / Docker / systemd bring it back up in a second).
import crypto from 'node:crypto';
import fs from 'node:fs';

import {
	type SettingKey,
	SETTINGS,
	type SettingView,
} from '@player1/shared/api';

export const DATA = process.env.DATA_DIR || 'data';
const FILE = `${DATA}/config.json`;
// every setting; secret ones never leave the server (the settings screen only learns whether
// they are set)
const SECRET: SettingKey[] = ['RD_TOKEN', 'TMDB_KEY', 'TORZNAB_KEY', 'QBIT_PASS', 'JELLYFIN_KEY'];
const isSetting = (k: string): k is SettingKey => (SETTINGS as readonly string[]).includes(k);
// empty lines in .env don't count
const env: Partial<Record<SettingKey, string>> = Object.fromEntries(SETTINGS
	.map(k => [k, process.env[k]])
	.filter(([, v]) => v));
export const inEnv = (k: SettingKey) => k in env;

let file: Record<string, string> = {};
try {
	file = JSON.parse(fs.readFileSync(FILE, 'utf8')) as Record<string, string>;
} catch { /* first start */ }
const write = () => {
	fs.mkdirSync(DATA, { recursive: true });
	fs.writeFileSync(FILE + '.tmp', JSON.stringify(file, null, 1), { mode: 0o600 });
	fs.renameSync(FILE + '.tmp', FILE);
};

// older installs: C411 by its own key, the access key in .env
if (process.env.C411_KEY && !env.TORZNAB_URL && !file.TORZNAB_URL) {
	env.TORZNAB_URL = 'https://c411.org/api/torznab';
	env.TORZNAB_KEY = process.env.C411_KEY;
}
// internal secrets, made once: the login cookie of paired devices and the signature of
// file-relay links
if (!file.ACCESS_KEY) {
	file.ACCESS_KEY = process.env.ACCESS_KEY || crypto.randomBytes(24).toString('base64url');
	write();
}

const apply = () => {
	for (const k of SETTINGS) process.env[k] = env[k] ?? file[k] ?? '';
	process.env.ACCESS_KEY = file.ACCESS_KEY;
};
apply();
export const configured = () => !!process.env.RD_TOKEN;

// first start: the setup screen opens with this one-time link (printed in the log and by the
// installer)
export function setupToken() {
	if (configured()) return null;
	if (!file.SETUP_TOKEN) {
		file.SETUP_TOKEN = crypto.randomBytes(16).toString('hex');
		write();
	}
	return file.SETUP_TOKEN;
}

// what the settings screen shows: plain values, and for secrets only whether they are set (and
// a key's last 4 characters; nothing of a password)
export const view = () => Object.fromEntries(SETTINGS.map(k => {
	const v = process.env[k] || '', secret = SECRET.includes(k);
	const shown: SettingView = {
		value: secret ? '' : v,
		set: !!v,
		hint: secret && v && !k.endsWith('_PASS') ? v.slice(-4) : '',
		env: inEnv(k),
	};
	return [k, shown];
})) as Record<SettingKey, SettingView>;

// save from the settings / setup screen: unknown and environment-set keys are ignored, an empty
// secret keeps the old one
export function save(patch: Record<string, unknown> | undefined) {
	for (const [k, v] of Object.entries(patch ?? {})) {
		if (!isSetting(k) || inEnv(k) || (SECRET.includes(k) && v === '')) continue;
		const s = String(v ?? '').trim();
		if (s) file[k] = s;
		else delete file[k];
	}
	if (file.RD_TOKEN) delete file.SETUP_TOKEN;
	write();
	apply();
}
