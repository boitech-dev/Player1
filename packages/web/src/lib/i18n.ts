import { i18n } from '@lingui/core';

import {
	isUiLang,
	type UiLang,
} from '@player1/shared/api';

// English is the source text in the code; src/locales/<code>.po holds each language's
// translations (npm run i18n:extract adds new strings). The language is the profile's, else this
// device's last one, else the browser's. Changing it reloads the page.

let current: UiLang = 'en';

export const browserLang = (): UiLang => /^fr/i.test(navigator.language || '') ? 'fr' : 'en';

const catalogs: Record<UiLang, () => Promise<{ messages: Record<string, unknown> }>> = {
	en: () => import('../locales/en.po'),
	fr: () => import('../locales/fr.po'),
};

export async function activate(code: string | null | undefined) {
	current = isUiLang(code) ? code : browserLang();
	const { messages } = await catalogs[current]();
	i18n.loadAndActivate({
		locale: current,
		messages: messages as never,
	});
	document.documentElement.lang = current;
	return current;
}

export const uiLang = () => current;
/** the locale dates and numbers are written in */
export const locale = () => current === 'fr' ? 'fr-FR' : 'en-GB';
/** a decimal number, with a decimal comma in French */
export const dec = (n: number | string) => current === 'fr'
	? String(n).replace('.', ',')
	: String(n);
