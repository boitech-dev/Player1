// Development: runs the server bundle the way run.mjs does (from the repo root, where packages/web/icons/
// is), again after every rebuild of dist/server.mjs, and again after it exits (saving the
// settings restarts the server on purpose).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const dist = path.join(import.meta.dirname, 'dist');
const bundle = path.join(dist, 'server.mjs');

let child = null;
let again;
function start() {
	child = spawn(process.execPath, ['--enable-source-maps', bundle], {
		cwd: root,
		stdio: 'inherit',
	});
	child.on('exit', () => {
		child = null;
		clearTimeout(again);
		again = setTimeout(start, 1000);
	});
}

// a rebuild writes the bundle and its map: restart once it has settled
let settle;
fs.watch(dist, (_, f) => {
	if (f !== 'server.mjs') return;
	clearTimeout(settle);
	settle = setTimeout(() => child ? child.kill() : start(), 300);
});
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => {
	child?.removeAllListeners('exit');
	child?.kill(sig);
	process.exit(0);
});
start();
