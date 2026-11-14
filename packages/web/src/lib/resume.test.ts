import {
	expect,
	test,
} from 'vitest';

import type { Progress } from '@player1/shared/api';

import {
	seen,
	standing,
} from './resume.ts';

const film = (id: string, pos: number, at: number, watched = false): Progress => ({
	id,
	type: 'movie',
	pos,
	dur: 7200,
	watched,
	at,
});

const ep = (e: number, pos: number, at: number, watched = false, next = true): Progress => ({
	id: 'show',
	type: 'series',
	s: 1,
	e,
	pos,
	dur: 1500,
	watched,
	at,
	next: next ? {
		s: 1,
		e: e + 1,
	} : undefined,
});

const says = (list: Progress[]) => standing(Object.fromEntries(list.map((p, i) => [String(i), p])))
	.map(p => `${p.id}${p.e ? ' E' + p.e : ''} @${p.pos}`);

test('films: only the ones left unfinished, latest first', () => {
	expect(says([
		film('old', 600, 1),
		film('seen', 7000, 2, true),
		film('glanced', 10, 3),
		film('new', 900, 4),
	])).toEqual(['new @900', 'old @600']);
});

test('a series whose last episode was finished offers the one after', () => {
	// the next one opened and closed before anything was saved
	expect(says([ep(3, 1455, 1, true), ep(4, 1561, 2, true)])).toEqual(['show E5 @0']);
});

test('an episode stopped at its start is still where the series stands', () => {
	expect(says([ep(4, 1561, 1, true), ep(5, 8, 2)])).toEqual(['show E5 @8']);
});

test('the episode played last wins over an older unfinished one', () => {
	expect(says([ep(2, 700, 1), ep(3, 1455, 2, true)])).toEqual(['show E4 @0']);
	expect(says([ep(2, 700, 3), ep(3, 1455, 2, true)])).toEqual(['show E2 @700']);
});

test('a series only glanced at, or finished, is not in progress', () => {
	expect(says([ep(1, 10, 1)])).toEqual([]);
	expect(says([ep(11, 1400, 1, true), ep(12, 1400, 2, true, false)])).toEqual([]);
});

test('seen: films, finished series, Discover\'s marks, latest first; not a series going on', () => {
	expect(seen({
		a: film('old', 7000, 1, true),
		b: film('half', 600, 2),
		c: ep(1, 1500, 3, true),
		d: {
			...ep(8, 1500, 4, true, false),
			id: 'done',
		},
		e: film('new', 7000, 5, true),
	}, {
		movieswiped: {
			id: 'swiped',
			type: 'movie',
			title: 'Swiped',
			at: 0,
		},
		movienew: {
			id: 'new',
			type: 'movie',
			title: 'New',
			at: 9,
		},
	}).map(p => p.id)).toEqual(['new', 'done', 'old', 'swiped']);
});
