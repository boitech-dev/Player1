import { t } from '@lingui/core/macro';

import type {
	DeviceMessage,
	Progress,
} from '@player1/shared/api';

import {
	getCaps,
	hwList,
	me,
} from '../lib/device.ts';
import {
	load,
	pinToken,
} from '../lib/store.ts';
import { closeSheet } from '../ui/sheet.tsx';
import { toast } from '../ui/toast.tsx';
import { playHash } from './router.ts';
import {
	app,
	setApp,
} from './state.ts';

// Every open device holds an event stream: the server knows who's online (Send lists them) and
// pushes preset changes and titles sent from another device. Reconnects with what changed (its
// name, the formats it plays).

let es: EventSource | null = null;
let gone = () => location.reload();
/** what to do when this device's profile is deleted (from another device) */
export const whenGone = (f: () => void) => {
	gone = f;
};

// progress from the server: an entry this device saved later itself (its save still on the way)
// stays
const merge = (got: Record<string, Progress>) => {
	const mine = app().progress;
	const newer = Object.entries(got).filter(([k, x]) => !((mine[k]?.at ?? 0) > x.at));
	if (newer.length) setApp({
		progress: {
			...mine, ...Object.fromEntries(newer), 
		}, 
	});
};

export async function connect() {
	es?.close();
	const hw = (await hwList()) + (getCaps() ? '' : ' (untested)');
	const q = new URLSearchParams({
		id: me.id,
		profile: load('profile') ?? '',
		pin: pinToken(),
		name: me.name,
		screen: `${innerWidth}x${innerHeight}@${devicePixelRatio}`,
		hw,
	});
	es = new EventSource(`/api/events?${q}`);
	es.onmessage = e => {
		const m = JSON.parse(e.data as string) as DeviceMessage;
		if (m.gone) return gone();
		if (m.preset) setApp({ preset: m.preset });
		if (m.progress) merge(m.progress);
		if (m.play) {
			closeSheet();
			const title = m.play.title;
			toast(t`Received: ${title}`);
			location.hash = playHash(m.play);
		}
	};
}
