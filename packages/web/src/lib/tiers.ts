import { t } from '@lingui/core/macro';

import type { Tier } from '@player1/shared/langs';

import { langWord } from './format.ts';

/** a tier in words: "French audio, no subtitles", "Original version, English subtitles"… */
export function tierSays(tier: Tier) {
	const [kind, code = ''] = tier.split(':');
	if (tier === 'vo') return t`Original version, no subtitles`;
	if (code === 'orig') return t`Original version, subtitles in its own language`;
	const lang = langWord(code);
	return kind === 'dub' ? t`${lang} audio, no subtitles` : t`Original version, ${lang} subtitles`;
}
