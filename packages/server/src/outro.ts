// Where an episode's end credits run, so the next episode is offered as they start: the file's own
// chapter marks, else TheIntroDB's crowd-sourced times. Nothing is guessed: no mark, no outro.
// Pure: tested on its own.
import type { Outro } from '@player1/shared/api';

/** a chapter as ffprobe gives it */
export interface Chapter { start_time: string; end_time: string; tags?: { title?: string } }

// whole titles only: Fargo has a scene called "Ed wonders if it worked"
const whole = (...names: string[]) => new RegExp(`^(${names.join('|')})$`, 'i');
const CREDITS = whole(
	'end(ing)?( ?(credits?|theme|song|card))?',
	'closing( credits?)?',
	'credits?',
	'ed ?\\d*',
	'outro',
	'g[ée]n[ée]rique( de fin)?',
	'abspann',
	'cr[ée]ditos',
	'エンディング',
);
// what may follow them, and still isn't the story
const PREVIEW = whole(
	'preview',
	'next( episode)?( preview)?',
	'next time',
	'pv',
	'trailer',
	'yokoku',
	'予告',
);
const named = (title = '') => CREDITS.test(title.trim()) || PREVIEW.test(title.trim());

// credits belong to the second half; one that stops within 30 s of the end runs to the end (the
// next episode is offered there anyway)
const span = (from: number, to: number, dur: number): Outro | undefined => {
	if (!(dur > 0) || from < dur / 2 || !(to > from)) return undefined;
	return {
		from,
		to: dur - to < 30 ? dur : to,
	};
};

/** from a file's chapters: the first one named as credits (or a preview), with those like it
 *  that follow. A scene after the credits is left out */
export function outroIn(chapters: Chapter[] = [], dur = 0) {
	const first = chapters.findIndex(c => +c.start_time >= dur / 2 && named(c.tags?.title));
	let last = first;
	while (chapters[last + 1] && named(chapters[last + 1]!.tags?.title)) last++;
	return first < 0 ? undefined : span(+chapters[first]!.start_time, +chapters[last]!.end_time, dur);
}

interface Mark { start_ms: number | null; end_ms: number | null; submission_count?: number }
/** TheIntroDB's answer for an episode (GET /media, details asked for) */
export interface Tidb { group_duration_ms?: number | null; credits?: Mark[]; preview?: Mark[] }

/** from TheIntroDB: only for the same cut as the file (its length within 10 s), and only a time
 *  at least two people sent in */
export function outroFrom(m: Tidb, dur = 0) {
	if (Math.abs((m.group_duration_ms ?? 0) / 1000 - dur) > 10) return undefined;
	const start = (x: Mark) => (x.start_ms ?? 0) / 1000;
	const end = (x: Mark) => x.end_ms == null ? dur : x.end_ms / 1000;
	const sure = (l: Mark[] = []) => l.find(x => (x.submission_count ?? 0) >= 2 && start(x) >= dur / 2);
	const credits = sure(m.credits), preview = sure(m.preview), first = credits ?? preview;
	if (!first) return undefined;
	// a preview right after the credits is part of the outro
	const joined = credits && preview && start(preview) - end(credits) < 5;
	return span(start(first), joined ? end(preview) : end(first), dur);
}
