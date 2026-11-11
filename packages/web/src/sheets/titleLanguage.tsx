import { t } from '@lingui/core/macro';

import type { Meta } from '@player1/shared/api';
import {
	choosableTiers,
	type Tier,
	tierTag,
} from '@player1/shared/langs';

import {
	currentPreset,
	presetSays,
	setApp,
	useApp,
} from '../app/state.ts';
import { post } from '../lib/api.ts';
import { tierSays } from '../lib/tiers.ts';
import {
	closeSheet,
	openSheet,
	Opt,
	Sheet,
} from '../ui/sheet.tsx';
import { toast } from '../ui/toast.tsx';

// a title can be held to one tier of the preset (always VOSTFR for this anime…); none follows it

export const titleKey = (m: { type: string; id: string }) => `${m.type}:${m.id}`;

function TitleLanguage({ m }: { m: Meta }) {
	const s = useApp();
	const key = titleKey(m);
	const own = s.titleModes[key];
	const preset = currentPreset(s);
	const name = preset?.name ?? '';
	const set = async (tier: Tier | null) => {
		setApp({
			titleModes: await post('titlemode', {
				key,
				tier,
			}),
		});
		closeSheet();
		const title = m.title;
		const mode = tier ? tierTag(tier) : '';
		toast(tier ? t`${title}: always in ${mode}` : t`${title} follows your language preset again`);
	};
	return (
		<Sheet title={t`Language for this title`}>
			<Opt title={t`Preset: ${name}`} sub={presetSays(preset)} on={!own} onClick={() => set(null)} />
			{choosableTiers(preset?.langs ?? []).map(tier => (
				<Opt
					key={tier}
					title={tierTag(tier)}
					sub={tierSays(tier)}
					on={own === tier}
					onClick={() => set(tier)}
				/>
			))}
		</Sheet>
	);
}

export const titleLanguageSheet = (m: Meta) => openSheet(<TitleLanguage m={m} />);
