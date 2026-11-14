import { t } from '@lingui/core/macro';

import {
	dec,
	locale,
	uiLang,
} from './i18n.ts';

/** 1:02:03, 4:05 */
export const hms = (secs: number) => {
	const s = Math.floor(secs);
	const h = Math.floor(s / 3600);
	const m = Math.floor(s / 60) % 60;
	const x = String(s % 60).padStart(2, '0');
	return h ? `${h}:${String(m).padStart(2, '0')}:${x}` : `${m}:${x}`;
};

/** 1.2 GB, 640 MB, 12 kB, with the unit in the interface's language */
export const bytes = (n: number) => {
	if (n >= 1e12) return `${dec((n / 1e12).toFixed(2))}\u00a0${t`TB`}`;
	if (n >= 1e9) return `${dec((n / 1e9).toFixed(1))}\u00a0${t`GB`}`;
	if (n >= 1e6) return `${Math.round(n / 1e6)}\u00a0${t`MB`}`;
	return `${Math.ceil(n / 1e3)}\u00a0${t`kB`}`;
};

/** 10 November 2026 */
export const day = (d: string | number) => new Date(d).toLocaleDateString(locale(), {
	day: 'numeric',
	month: 'long',
	year: 'numeric',
});

/** 10 November, 14:05 */
export const moment = (d: number) => new Date(d).toLocaleString(locale(), {
	day: 'numeric',
	month: 'long',
	hour: '2-digit',
	minute: '2-digit',
});

export const episodeName = (s: number, e: number) => t`Season ${s}, episode ${e}`;

/** a language's name inside a sentence: "anglais" in French, "English" in English */
export const langWord = (code: string) => {
	try {
		return new Intl.DisplayNames([locale()], { type: 'language' }).of(code) ?? code;
	} catch {
		return code;
	}
};

/** a language's name on its own, in the interface's language, capitalised */
export const langName = (code: string) => {
	try {
		const n = new Intl.DisplayNames([locale()], { type: 'language' }).of(code) ?? code;
		return n[0]!.toUpperCase() + n.slice(1);
	} catch {
		return code;
	}
};

/** an age as read here: 12+, or in French France's way, -12; 0 is all ages */
export const ageSays = (age: number) => {
	if (!age) return t`All ages`;
	return uiLang() === 'fr' ? `-${age}` : `${age}+`;
};

/** a title's age rating as read here: in French, France's categories (any rating goes up to the
 *  next: TV-14 is -16); elsewhere the name of its rating where the profile lives (PG-13), else its
 *  age (14+) */
export function ratingSays(age: number, rating?: string) {
	if (!age) return t`All ages`;
	if (uiLang() === 'fr') return ageSays([10, 12, 16].find(a => age <= a) ?? 18);
	return rating && !/^\d+$/.test(rating) ? rating : ageSays(age);
}
