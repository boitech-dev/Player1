import './styles/global.scss';
import './ui/spatial.ts';

import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { createRoot } from 'react-dom/client';

import { App } from './app/App.tsx';
import { activate } from './lib/i18n.ts';
import {
	load,
	setSetupToken,
} from './lib/store.ts';
import { setPlayingCheck } from './player/bench.ts';
import { playingNow } from './player/engine.ts';
import { setConfirmSheet } from './player/engine.ts';
import { confirmSheet } from './sheets/indexer.tsx';

// the installer's one-time setup link: kept for this tab, then out of the address
const setup = new URLSearchParams(location.search).get('setup');
if (setup) {
	setSetupToken(setup);
	history.replaceState(null, '', '/' + location.hash);
}

setConfirmSheet(confirmSheet);
setPlayingCheck(playingNow);

// before anything shows: this device's last language, else the browser's
await activate(load('lang'));
createRoot(document.getElementById('root')!).render(
	<I18nProvider i18n={i18n}>
		<App />
	</I18nProvider>,
);
