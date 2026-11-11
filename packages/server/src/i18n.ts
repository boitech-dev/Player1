// Languages: English in the code, src/locales/<code>.po holds each translation (Lingui). A
// profile's own language, else the device's (x-lang header), else French.
import {
	type I18n,
	type MessageDescriptor,
	setupI18n,
} from '@lingui/core';

import {
	isUiLang,
	UI_LANGS,
	type UiLang,
} from '@player1/shared/api';

import {
	me,
	request,
} from './db.ts';
import { messages as en } from './locales/en.po';
import { messages as fr } from './locales/fr.po';

const CATALOGS = {
	en,
	fr,
};
const instances = Object.fromEntries(UI_LANGS.map(l => [l, setupI18n({
	locale: l,
	messages: { [l]: CATALOGS[l] },
})])) as Record<UiLang, I18n>;

export const lang = () => me().lang || request.getStore()?.lang || 'fr';
/** a language Player1 doesn't speak gets English */
export const i18nFor = (l?: string) => instances[isUiLang(l) ? l : 'en'];
/** in the language of the request at hand */
export const t = (d: MessageDescriptor) => i18nFor(lang())._(d);

/** an error the person sees: translated for the request that hit it (English in the log) */
export class UserError extends Error {
	constructor(readonly descriptor: MessageDescriptor) {
		super(i18nFor('en')._(descriptor));
	}
}
