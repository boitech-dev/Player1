import { lingui } from '@lingui/vite-plugin';
import { defineConfig } from 'vite';

// The server ships as one file, dist/server.mjs: everything it imports is bundled in, so it runs
// on a bare Node with no node_modules (run.mjs swaps it in whole, and back on a failed start).
export default defineConfig({
	plugins: [lingui({ macroTransform: true })],
	// ssh2 is CommonJS and names its own folder (for a Windows helper it never runs here)
	define: { __dirname: 'import.meta.dirname' },
	// ssh2's two optional native speed-ups can't live in one file: left out, it uses Node's own crypto
	ssr: {
		noExternal: true,
		external: ['cpu-features'],
	},
	build: {
		ssr: 'src/main.ts',
		outDir: 'dist',
		target: 'node22',
		minify: false,
		sourcemap: true,
		rollupOptions: {
			external: [/\.node$/],
			output: { entryFileNames: 'server.mjs' },
		},
	},
});
