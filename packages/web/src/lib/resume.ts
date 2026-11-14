import type {
	Marked,
	MediaType,
	Progress,
} from '@player1/shared/api';

export type Standing = Progress & { id: string };

/**
 * Where each title stands, latest first: the film or episode left unfinished, else the episode
 * after the one finished last. A title opened and closed within 30 s was never begun.
 */
export function standing(progress: Record<string, Progress>): Standing[] {
	const begun = new Set<string>();
	for (const p of Object.values(progress)) {
		if (p.id && (p.watched || p.pos > 30)) begun.add(p.id);
	}
	return latest(progress)
		.filter(p => begun.has(p.id) && (!p.watched || p.next))
		.sort((a, b) => b.at - a.at)
		.map(p => p.watched ? {
			...p,
			...p.next,
			pos: 0,
		} : p);
}

/** each title's latest film or episode entry (a film and a series can share a TMDB number) */
function latest(progress: Record<string, Progress>): Standing[] {
	const last = new Map<string, Standing>();
	for (const p of Object.values(progress)) {
		const k = (p.type ?? 'movie') + p.id;
		if (p.id && p.at >= (last.get(k)?.at ?? 0)) last.set(k, p as Standing);
	}
	return [...last.values()];
}

export interface Seen {
	id: string;
	type: MediaType;
	title: string;
	sub?: string;
	poster?: string;
	/** when (0: unknown) */
	at: number;
}

/** the titles seen through, latest first: a film watched, a series whose last episode is, or
 *  either marked "already seen" in Discover */
export function seen(
	progress: Record<string, Progress>,
	marked: Record<string, Marked> = {},
): Seen[] {
	const out = new Map<string, Seen>(Object.entries(marked));
	for (const p of latest(progress)) {
		const type = p.type ?? 'movie';
		if (p.watched && !p.next) out.set(type + p.id, {
			id: p.id,
			type,
			title: p.title ?? '',
			poster: p.poster,
			at: p.at,
		});
	}
	return [...out.values()].sort((a, b) => b.at - a.at);
}
