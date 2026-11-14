import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
	expect,
	it,
	vi,
} from 'vitest';

// a household of its own: a parent and a child held to 12
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p1-household-'));
vi.stubEnv('DATA_DIR', dir);
const { db, newProfile, request } = await import('./db.ts');
const { householdPosts } = await import('./household.ts');
const parent = newProfile('Parent', 0), child = newProfile('Child', 1);
child.maxAge = 12;
db.profiles = [parent, child];

const as = <T>(profile: typeof parent, fn: () => T) => request.run({ profile }, fn);
const edit = (body: object) => householdPosts.profiles!(body as never, {} as never);
const unlock = (id: string, pin: string, settings?: boolean) => householdPosts.unlock!({
	id,
	pin,
	settings,
}, {} as never) as { token: string };

it('keeps a PIN to open a profile and a separate one for its settings', () => {
	as(parent, () => edit({
		id: parent.id,
		pin: '1234',
		guardPin: 'abcd',
		guard: 'own',
	}));
	expect(() => unlock(parent.id, 'abcd')).toThrow();
	const open = unlock(parent.id, '1234').token, settings = unlock(parent.id, 'abcd', true).token;
	expect(open).not.toBe(settings);
	// opened with its PIN, its settings still ask theirs
	expect(() => as(parent, () => edit({
		id: parent.id,
		name: 'P',
		auth: open,
	}))).toThrow();
	as(parent, () => edit({
		id: parent.id,
		guard: 'same',
		auth: settings,
	}));
	expect(unlock(parent.id, '1234', true).token).toBe(open);
	// the opening PIN goes: its settings keep it
	as(parent, () => edit({
		id: parent.id,
		pin: '',
		auth: open,
	}));
	expect(parent.pin).toBeUndefined();
	expect(unlock(parent.id, '1234', true).token).toBe(open);
});

it('keeps a child within its limit, behind its settings PIN', () => {
	expect(() => as(child, () => edit({
		id: parent.id,
		name: 'X',
	}))).toThrow();
	as(child, () => edit({
		id: child.id,
		guardPin: '5555',
		guard: 'own',
	}));
	expect(() => as(child, () => edit({
		id: child.id,
		maxAge: null,
	}))).toThrow();
	as(child, () => edit({
		id: child.id,
		maxAge: 16,
		auth: unlock(child.id, '5555', true).token,
	}));
	expect(child.maxAge).toBe(16);
	expect(() => as(parent, () => edit({
		id: parent.id,
		maxAge: 12,
		auth: parent.guardPin,
	}))).toThrow();
	// from any other profile: never, its settings PIN or not
	expect(() => as(parent, () => edit({
		id: child.id,
		maxAge: null,
		auth: unlock(child.id, '5555', true).token,
	}))).toThrow();
	expect(() => as(parent, () => edit({
		name: 'New',
		maxAge: 12,
	}))).toThrow();
	// a new profile would be a way out: its settings PIN first
	expect(() => as(child, () => edit({ name: 'Other' }))).toThrow();
	as(child, () => edit({
		name: 'Other',
		auth: unlock(child.id, '5555', true).token,
	}));
	expect(db.profiles.at(-1)?.name).toBe('Other');
});
