import { defineConfig } from '@lingui/cli';
import { formatter } from '@lingui/format-po';

// English is the source; each language's translations are in src/locales/<code>.po
export default defineConfig({
	sourceLocale: 'en',
	locales: ['en', 'fr'],
	// keep the source file in `#:` refs but drop the line: it churns the .po diff whenever code moves
	format: formatter({ lineNumbers: false }),
	catalogs: [{
		path: '<rootDir>/src/locales/{locale}',
		include: ['src'],
	}],
});
