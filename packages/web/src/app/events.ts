import { t } from '@lingui/core/macro';

import type { DeviceMessage } from '@player1/shared/api';

import {
	getCaps,
	hwList,
	me,
} from '../lib/device.ts';
import { load } from '../lib/store.ts';
import { closeSheet } from '../ui/sheet.tsx';
import { toast } from '../ui/toast.tsx';
import { playHash } from './router.ts';
import { setApp } from './state.ts';

// Every open device holds an event stream: the server knows who's online (Send lists them) and
// pushes preset changes and titles sent from another device. Reconnects with what changed (its
// name, the formats it plays).

let es: EventSource | null = null;

export async function connect() {
	es?.close();
	const hw = (await hwList()) + (getCaps() ? '' : ' (untested)');
	const q = new URLSearchParams({
		id: me.id,
		profile: load('profile') ?? '',
		name: me.name,
		screen: `${innerWidth}x${innerHeight}@${devicePixelRatio}`,
		hw,
	});
	es = new EventSource(`/api/events?${q}`);
	es.onmessage = e => {
		const m = JSON.parse(e.data as string) as DeviceMessage;
		if (m.preset) setApp({ preset: m.preset });
		if (m.play) {
			closeSheet();
			const title = m.play.title;
			toast(t`Received: ${title}`);
			location.hash = playHash(m.play);
		}
	};
}
