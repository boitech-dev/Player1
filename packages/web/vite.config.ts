import { lingui } from '@lingui/vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// in development the page runs here and the server on its own port (npm run dev at the root)
const server = `http://localhost:${process.env.PORT ?? 6510}`;

export default defineConfig({
	plugins: [react(), lingui({ macroTransform: true })],
	build: {
		outDir: 'dist',
		target: 'es2022',
		// hls.js (~580 kB) is its own chunk, only fetched when a Real-Debrid stream starts
		chunkSizeWarningLimit: 600,
	},
	server: {
		port: Number(process.env.WEB_PORT ?? 5173),
		host: process.env.WEB_HOST ?? true,
		allowedHosts: ['.lan'],
		// behind a proxy (player1.lan), live reload connects through the proxy's port
		hmr: process.env.HMR_CLIENT_PORT ? { clientPort: Number(process.env.HMR_CLIENT_PORT) } : undefined,
		proxy: Object.fromEntries([
			'/api',
			'/icons',
			'/samples',
			'/manifest.webmanifest',
			'/player1.apk',
			'/player1.ipk',
			'/webos.json',
		]
			.map(p => [p, {
				target: server,
				changeOrigin: false,
			}])),
	},
});
