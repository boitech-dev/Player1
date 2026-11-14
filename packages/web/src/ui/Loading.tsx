import { t } from '@lingui/core/macro';

import s from './Loading.module.scss';

/** the lamp beam sweeping: something is on its way */
export const Beam = ({ hidden }: { hidden?: boolean }) => (
	<div className={s.beam} hidden={hidden} role="progressbar" aria-label={t`Loading`} />
);

/** a page waiting for what it shows: the beam, after a moment so a quick answer doesn't flash it */
export const Loading = () => (
	<div className={s.loading}>
		<Beam />
	</div>
);
