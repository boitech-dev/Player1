import type { PlayRequest } from '@player1/shared/api';

import { playHash } from '../app/router.ts';
import { play } from './engine.ts';

/** plays a request: a new page, or the same one again (another source or quality) */
export function openPlay(req: PlayRequest, replace = false) {
	const h = playHash(req);
	if (location.hash === h) play(req);
	else if (replace) location.replace(h);
	else location.hash = h;
}
