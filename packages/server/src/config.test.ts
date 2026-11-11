import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
	afterAll,
	beforeAll,
	describe,
	expect,
	it,
	vi,
} from 'vitest';

import { SETTINGS } from '@player1/shared/api';

let dir = '', config: typeof import('./config.ts');
const saved = () => {
	const text = fs.readFileSync(path.join(dir, 'config.json'), 'utf8');
	return JSON.parse(text) as Record<string, string>;
};

// config.ts reads the environment and data/config.json once, when imported
beforeAll(async () => {
	dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p1-config-'));
	for (const k of [...SETTINGS, 'ACCESS_KEY', 'C411_KEY']) vi.stubEnv(k, '');
	vi.stubEnv('DATA_DIR', dir);
	vi.stubEnv('TMDB_KEY', 'from-the-env-1234');
	vi.resetModules();
	config = await import('./config.ts');
});
afterAll(() => {
	vi.unstubAllEnvs();
	fs.rmSync(dir, {
		recursive: true,
		force: true,
	});
});

describe('settings', () => {
	it('start unconfigured, with an access key and a setup token', () => {
		expect(config.configured()).toBe(false);
		expect(config.setupToken()).toMatch(/^[0-9a-f]{32}$/);
		expect(saved().ACCESS_KEY).toBeTruthy();
	});
	it('never show a secret, only whether it is set and its end', () => {
		const v = config.view();
		expect(v.RD_TOKEN).toEqual({
			value: '',
			set: false,
			hint: '',
			env: false,
		});
		expect(v.TMDB_KEY).toEqual({
			value: '',
			set: true,
			hint: '1234',
			env: true,
		});
		expect(Object.keys(v)).toEqual([...SETTINGS]);
	});
	it('save known keys only, trimmed; the environment wins; an empty secret keeps the old one', () => {
		config.save({
			RD_TOKEN: ' rd-secret-abcd ',
			TMDB_KEY: 'ignored',
			STREAM_ADDON: 'https://addon.example',
			BOGUS: 'x',
		});
		expect(saved()).toMatchObject({
			RD_TOKEN: 'rd-secret-abcd',
			STREAM_ADDON: 'https://addon.example',
		});
		expect(saved()).not.toHaveProperty('TMDB_KEY');
		expect(saved()).not.toHaveProperty('BOGUS');
		expect(saved()).not.toHaveProperty('SETUP_TOKEN');
		expect(config.configured()).toBe(true);
		expect(config.setupToken()).toBeNull();
		expect(config.view().RD_TOKEN).toMatchObject({
			value: '',
			hint: 'abcd',
		});
		expect(config.view().STREAM_ADDON.value).toBe('https://addon.example');

		config.save({
			RD_TOKEN: '',
			STREAM_ADDON: '',
		});
		expect(saved().RD_TOKEN).toBe('rd-secret-abcd');
		expect(saved()).not.toHaveProperty('STREAM_ADDON');
		expect(process.env.STREAM_ADDON).toBe('');
	});
});
