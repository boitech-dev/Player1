import js from '@eslint/js';
import stylistic from '@stylistic/eslint-plugin';
import importNewlines from 'eslint-plugin-import-newlines';
import reactHooks from 'eslint-plugin-react-hooks';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Lines exempt from max-len: a lone <Trans>, a `t`/msg i18n template, a line holding one string
// (long prose in a list), single string declarations, and pure prose/JSX-text lines. All of it
// text we can't reflow anyway.
const maxLenIgnore = [
	'^\\t*<Trans>.*</Trans>$',
	'(t|msg)`.*`[,;)]*$',
	'`.*`,?$',
	'^\\t*([\'"]).*\\1,?$',
	'^\\t*(?:const|let|var) \\w+ = ([`\'"]).*\\1;?$',
	'^\\t*[^{}();=]*[A-Za-z][^{}();=]*$',
	'.*throw new.*',
	'^\\t*return `.*`;$',
].join('|');

export default tseslint.config(
	{
		ignores: [
			'.claude/**',
			'**/dist/**',
			'**/node_modules/**',
			'data/**',
			'tv/out/**',
			'webos/out/**',
		],
	},
	js.configs.recommended,
	...tseslint.configs.recommended,
	{
		languageOptions: { parserOptions: { tsconfigRootDir: import.meta.dirname } },
		plugins: {
			'@stylistic': stylistic,
			'import-newlines': importNewlines,
			'simple-import-sort': simpleImportSort,
		},
		rules: {
			'import-newlines/enforce': ['error', { items: 1 }],
			// side effects first (CSS cascades by their order), then node's, other packages,
			// ours, and relative imports last
			'simple-import-sort/imports': ['error', {
				groups: [
					['^\\u0000'],
					['^node:'],
					['^(?!@player1/)@?\\w'],
					['^@player1/'],
					['^\\.'],
				],
			}],
			'@stylistic/indent': ['error', 'tab'],
			'@stylistic/semi': 'error',
			'@stylistic/quotes': ['error', 'single', { avoidEscape: true }],
			'@stylistic/max-len': ['error', {
				'code': 100,
				'tabWidth': 0,
				'ignorePattern': maxLenIgnore,
				'ignoreComments': true,
				'ignoreUrls': true,
			}],
			'no-tabs': 'off',
			'complexity': ['error', { 'max': 14 }],
			'comma-dangle': ['error', 'always-multiline'],
			'object-curly-spacing': ['error', 'always'],
			'object-curly-newline': ['error', {
				ObjectExpression: {
					multiline: true,
					minProperties: 2,
				},
			}],
			'@typescript-eslint/no-unused-vars': ['error', {
				argsIgnorePattern: '^_',
				caughtErrors: 'none',
			}],
		},
	},
	{
		files: ['packages/web/src/**'],
		languageOptions: { globals: globals.browser },
		plugins: { 'react-hooks': reactHooks },
		rules: {
			'react-hooks/rules-of-hooks': 'error',
			'react-hooks/exhaustive-deps': 'error',
		},
	},
	{
		// the supervisor, the TV build and the sample maker run on plain Node, before any install
		files: ['**/*.mjs', '**/*.js'],
		languageOptions: { globals: globals.node },
	},
);
