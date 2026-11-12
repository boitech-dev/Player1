import type { Progress } from '@player1/shared/api';

export type Standing = Progress & { id: string };

/**
 * Where each title stands, latest first: the film or episode left unfinished, else the episode
 * after the one finished last. A title opened and closed within 30 s was never begun.
 */
export function standing(progress: Record<string, Progress>): Standing[] {
	const last = new Map<string, Standing>();
	const begun = new Set<string>();
	for (const p of Object.values(progress)) {
		if (!p.id) continue;
		if (p.watched || p.pos > 30) begun.add(p.id);
		if (p.at >= (last.get(p.id)?.at ?? 0)) last.set(p.id, p as Standing);
	}
	return [...last.values()]
		.filter(p => begun.has(p.id) && (!p.watched || p.next))
		.sort((a, b) => b.at - a.at)
		.map(p => p.watched ? {
			...p,
			...p.next,
			pos: 0,
		} : p);
}
