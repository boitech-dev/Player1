import { lingui } from '@lingui/vite-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	// the server's translated messages (msg`…`) are compiled the way its build does
	plugins: [lingui({
		macroTransform: true,
		configPath: 'packages/server/lingui.config.ts',
	})],
	test: { include: ['packages/*/src/**/*.test.ts'] },
});
