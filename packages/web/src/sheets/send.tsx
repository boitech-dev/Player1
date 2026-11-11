import { t } from '@lingui/core/macro';

import type {
	Device,
	PlayRequest,
} from '@player1/shared/api';

import {
	get,
	post,
} from '../lib/api.ts';
import { me } from '../lib/device.ts';
import {
	closeSheet,
	openSheet,
	Opt,
	Sheet,
} from '../ui/sheet.tsx';
import tx from '../ui/text.module.scss';
import { toast } from '../ui/toast.tsx';

// Send: another open device (the TV, the projector) starts playing this title

function SendTo({
	req,
	devices,
}: { req: PlayRequest; devices: Device[] }) {
	const send = async (d: Device) => {
		await post('send', {
			to: d.id,
			play: {
				...req,
				url: undefined,
			},
		});
		closeSheet();
		const name = d.name;
		toast(t`Sent to ${name}`);
	};
	return (
		<Sheet title={t`Send to`}>
			{devices.map(d => <Opt key={d.id} title={d.name} onClick={() => send(d)} />)}
			{!devices.length && (
				<p className={tx.empty}>
					{t`No other device is connected. Open Player1 on the TV or projector and it will show up here.`}
				</p>
			)}
		</Sheet>
	);
}

export async function sendSheet(req: PlayRequest) {
	const devices = (await get('devices')).filter(d => d.id !== me.id);
	openSheet(<SendTo req={req} devices={devices} />);
}
