import { t } from '@lingui/core/macro';

import type {
	PlayRequest,
	Stream,
} from '@player1/shared/api';
import {
	canName,
	RES_LABEL,
} from '@player1/shared/release';

import { get } from '../lib/api.ts';
import {
	hwList,
	me,
	preferredQuality,
} from '../lib/device.ts';
import { keep } from '../lib/store.ts';
import {
	currentLive,
	currentRequest,
} from '../player/engine.ts';
import { openPlay } from '../player/open.ts';
import {
	Big,
	closeSheet,
	openSheet,
	Opt,
	Sheet,
} from '../ui/sheet.tsx';
import { Tag } from '../ui/Tag.tsx';
import tx from '../ui/text.module.scss';

// Quality: Automatic, then one row per available resolution; each opens its sources. Picking a
// resolution (or a source in it) becomes this device's preference.

interface Ctx {
	req: PlayRequest;
	list: Stream[];
	hw: string[];
	/** what plays now, when this sheet opened from the player */
	res: number | null;
	url: string | null;
}

function choose(c: Ctx, q: number, url?: string) {
	keep('quality', q || null);
	closeSheet();
	openPlay({
		...c.req,
		url,
	}, !!c.res);
}

function Group({
	c,
	r,
}: { c: Ctx; r: number }) {
	const items = c.list.filter(x => x.res === r);
	const sub = (x: Stream) => {
		const [release = '', info = ''] = x.title.split('\n');
		const size = /💾 ([\d.]+ \w+)/.exec(info)?.[1];
		const n = x.seeds;
		const heavy = (x.tz || x.lib) && !canName(release, x.res, c.hw);
		const name = x.name;
		return [
			size,
			t`${n} sources`,
			x.tz && t`${name}, download first`,
			x.lib && t`In ${name}`,
			heavy && t`heavy for this device`,
		].filter(Boolean).join('   ');
	};
	return (
		<Sheet title={RES_LABEL[r] ?? String(r)} onBack={() => openSheet(<Top c={c} />)}>
			<Opt
				title={t`Recommended`}
				sub={t`The best source in your language at this quality`}
				onClick={() => choose(c, r)}
			/>
			{items.map(x => (
				<Opt
					key={x.url}
					lead={<Tag tag={x.tag} />}
					title={x.title.split('\n')[0]}
					sub={sub(x)}
					on={c.url === x.url}
					onClick={() => choose(c, r, x.url)}
				/>
			))}
		</Sheet>
	);
}

function Top({ c }: { c: Ctx }) {
	const groups = [...new Set(c.list.map(x => x.res))].sort((a, b) => b - a);
	const pref = preferredQuality();
	const name = me.name;
	return (
		<Sheet title={t`Quality`}>
			<Opt
				title={t`Automatic`}
				sub={t`The best available in your language`}
				on={!pref}
				onClick={() => choose(c, 0)}
			/>
			{groups.map(r => {
				const n = c.list.filter(x => x.res === r).length;
				const big = r > 1080 ? t`Shown in 1080p, when Real-Debrid can convert it` : '';
				const sub = r === c.res ? t`Now playing` : big;
				return (
					<Opt
						key={r}
						lead={<Big>{RES_LABEL[r]}</Big>}
						title={n > 1 ? t`${n} sources` : t`${n} source`}
						sub={sub}
						on={pref === r}
						onClick={() => openSheet(<Group c={c} r={r} />)}
					/>
				);
			})}
			{!groups.length && <p className={tx.empty}>{t`No source for this title.`}</p>}
			<p className={tx.hint} style={{ padding: '0 14px' }}>
				{t`${name} will remember this choice and pick the closest quality next time.`}
			</p>
		</Sheet>
	);
}

export async function qualitySheet(req: PlayRequest) {
	openSheet(
		<Sheet title={t`Quality`}>
			<p className={tx.empty}>{t`Looking for sources…`}</p>
		</Sheet>,
	);
	const [all, hw] = await Promise.all([
		get('streams', {
			type: req.type,
			imdb: req.imdb,
			s: req.s,
			e: req.e,
		}),
		hwList(),
	]);
	const live = req === currentRequest() ? currentLive() : null;
	openSheet(
		<Top
			c={{
				req,
				list: all.filter(x => x.cached || x.tz || x.lib),
				hw: hw.split(','),
				res: live?.res ?? null,
				url: live?.url ?? null,
			}}
		/>,
	);
}
