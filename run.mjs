// Player1's entry point (Docker CMD, systemd ExecStart): builds and runs the app, and installs
// updates from the git remote's master branch. Nothing is ever downloaded as a build: only source
// code, npm packages pinned by package-lock.json, and toolchains checked against their checksums.
//
// The app is built into data/app: server.mjs (the server, one file) and web/ (the interface).
// An update is built and tried aside before it replaces anything:
//  1. fetch master; stop if nothing is new, the checkout has local changes, or this commit was
//     already rolled back
//  2. check out the new code in data/stage, fetch the Node version it asks for (package.json engines.node)
//  3. install its packages and run every check: types, lint, tests, then the build (data/app.next)
//  4. try it: a real start on a copy of the settings and household data
//  5. switch: git moves to the new commit, data/app.next becomes data/app (the previous build kept
//     in data/app.prev), a new TV app goes in data/dist the same way, runtimes stay side by side
//  6. restart; if the new version crashes within its first 2 minutes: previous commit, build,
//     runtime and TV app come back
// Plain Node only, no packages: it runs before anything is installed.
import {
	execFileSync,
	spawn,
} from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';

const ROOT = path.dirname(new URL(import.meta.url).pathname);
process.chdir(ROOT);
const DATA = path.resolve(process.env.DATA_DIR || 'data');
const STATE = `${DATA}/update.json`;
const DIST = `${DATA}/dist`; // the TV app
const APP = `${DATA}/app`; // the server and the interface
const EVERY = 6 * 3600e3;
const TRIAL = 120e3;
const log = (...a) => console.log('[update]', ...a);
const readJSON = (f, d = {}) => {
	try {
		return JSON.parse(fs.readFileSync(f));
	} catch {
		return d;
	}
};
const state = () => readJSON(STATE);
const save = patch => {
	fs.mkdirSync(DATA, { recursive: true });
	const s = {
		...state(),
		...patch,
	};
	fs.writeFileSync(STATE, JSON.stringify(s, null, 1));
	return s;
};
// settings as the server sees them: data/config.json, the environment on top
const cfg = () => ({
	...readJSON(`${DATA}/config.json`),
	...Object.fromEntries(Object.entries(process.env).filter(([, v]) => v)),
});
const git = (...a) => execFileSync('git', a, {
	encoding: 'utf8',
	stdio: ['ignore', 'pipe', 'pipe'],
}).trim();
const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, {
	stdio: ['ignore', 'pipe', 'pipe'],
	maxBuffer: 1e8,
	...opts,
}).toString();
const rm = p => fs.rmSync(p, {
	recursive: true,
	force: true,
});
/** a folder swapped in whole: the current one is kept as <dir>.prev */
function swapIn(dir) {
	rm(`${dir}.prev`);
	if (fs.existsSync(dir)) fs.renameSync(dir, `${dir}.prev`);
	fs.renameSync(`${dir}.next`, dir);
}
function swapBack(dir) {
	if (!fs.existsSync(`${dir}.prev`)) return;
	rm(dir);
	fs.renameSync(`${dir}.prev`, dir);
}

// --- Node runtime: the one the code asks for in package.json (engines.node); the one running this file when
// it is that or newer ---
const newer = (a, b) => {
	const x = a.split('.').map(Number);
	const y = b.split('.').map(Number);
	return x[0] === y[0] && (x[1] - y[1] || x[2] - y[2]) >= 0;
};
async function nodeFor(dir) {
	const want = JSON.parse(fs.readFileSync(`${dir}/package.json`, 'utf8')).engines?.node;
	if (!want || newer(process.version.slice(1), want)) return process.execPath;
	const arch = {
		x64: 'x64',
		arm64: 'arm64',
	}[process.arch];
	const name = `node-v${want}-linux-${arch}`;
	const bin = `${DATA}/runtime/${name}/bin/node`;
	if (fs.existsSync(bin)) return bin;
	log('downloading Node', want);
	const base = `https://nodejs.org/dist/v${want}`;
	const sums = await (await fetch(`${base}/SHASUMS256.txt`)).text();
	const sum = new RegExp(`^([0-9a-f]{64})  ${name}\\.tar\\.xz$`, 'm').exec(sums)?.[1];
	if (!sum) throw new Error(`no ${name} on nodejs.org`);
	const r = await fetch(`${base}/${name}.tar.xz`);
	if (!r.ok) throw new Error(`Node download ${r.status}`);
	const buf = Buffer.from(await r.arrayBuffer());
	if (crypto.createHash('sha256').update(buf).digest('hex') !== sum) throw new Error('Node download: checksum mismatch');
	const tmp = `${DATA}/runtime/${name}.tmp`;
	rm(tmp);
	fs.mkdirSync(tmp, { recursive: true });
	fs.writeFileSync(`${tmp}.tar.xz`, buf);
	sh('tar', ['-xJf', `${tmp}.tar.xz`, '-C', tmp, '--strip-components=1']);
	fs.rmSync(`${tmp}.tar.xz`);
	fs.renameSync(tmp, `${DATA}/runtime/${name}`);
	return bin;
}

// --- building: packages from package-lock.json, then the checks and the bundles ---
/** npm as shipped with this Node runtime (nodejs.org builds and the Docker image both carry it) */
const npmOf = node => path.join(path.dirname(node), '../lib/node_modules/npm/bin/npm-cli.js');
function npm(node, dir, args) {
	return new Promise((ok, ko) => {
		const p = spawn('nice', ['-n', '19', node, npmOf(node), ...args], {
			cwd: dir,
			env: {
				...process.env,
				npm_config_cache: `${DATA}/npm-cache`,
				npm_config_update_notifier: 'false',
				npm_config_fund: 'false',
				npm_config_audit: 'false',
				// the toolchain's own bin/ first: npm scripts run with this Node, not another one
				PATH: `${path.dirname(node)}:${process.env.PATH}`,
			},
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		let out = '';
		p.stdout.on('data', d => out += d);
		p.stderr.on('data', d => out += d);
		const failed = () => new Error(`npm ${args.join(' ')} failed: ${out.slice(-1500)}`);
		p.on('exit', code => code ? ko(failed()) : ok());
	});
}
/** installs, checks (unless quick) and builds dir's code into out: server.mjs and web/ */
async function build(dir, node, out, { quick = false } = {}) {
	log(quick ? 'building' : 'checking and building', path.relative(ROOT, dir) || 'this checkout');
	await npm(node, dir, ['ci']);
	await npm(node, dir, ['run', quick ? 'build' : 'check']);
	rm(out);
	fs.mkdirSync(out, { recursive: true });
	for (const f of ['server.mjs', 'server.mjs.map']) {
		const src = `${dir}/packages/server/dist/${f}`;
		if (fs.existsSync(src)) fs.copyFileSync(src, `${out}/${f}`);
	}
	fs.cpSync(`${dir}/packages/web/dist`, `${out}/web`, { recursive: true });
}

// --- the server process ---
let child = null;
let startedAt = 0;
let restarting = false;
function start() {
	const s = state();
	const node = s.node && fs.existsSync(s.node) ? s.node : process.execPath;
	startedAt = Date.now();
	child = spawn(node, ['--enable-source-maps', `${APP}/server.mjs`], { stdio: 'inherit' });
	child.on('exit', code => {
		child = null;
		if (restarting) {
			restarting = false;
			return start();
		}
		const t = state().trial;
		if (t && code && Date.now() - startedAt < TRIAL) return rollback(`exited with code ${code}`);
		if (code === 0) { // settings saved (the public address may have changed)
			ensureTv();
			ensureWebos();
		}
		setTimeout(start, code === 0 ? 100 : 2000);
	});
}
const restart = () => {
	if (!child) return start();
	restarting = true;
	child.kill('SIGTERM');
};
setInterval(() => {
	const t = state().trial;
	if (t && child && !restarting && Date.now() - startedAt > TRIAL) { // not the old server's uptime
		save({
			trial: null,
			status: 'updated',
		});
		log('new version confirmed');
	}
}, 10e3);
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => {
	child?.kill(sig);
	process.exit(0);
});

// a run.mjs change only takes effect when this process restarts: Docker / systemd bring it back
const selfChanged = (a, b) => !!git('diff', '--name-only', a, b, '--', 'run.mjs');
function rollback(why) {
	const s = state();
	const t = s.trial;
	log('new version', t.sha.slice(0, 7), why, '- going back to', s.prev.head.slice(0, 7));
	git('reset', '--hard', '--quiet', s.prev.head);
	swapBack(APP);
	if (s.prev.dist) swapBack(DIST);
	save({
		node: s.prev.node,
		trial: null,
		bad: t.sha,
		status: 'rolled-back',
		error: why,
	});
	if (selfChanged(s.prev.head, t.sha)) process.exit(1);
	start();
}

// --- trying a staged version: a real start on a copy of the settings and data, background jobs
// off ---
const freePort = () => new Promise(ok => {
	const s = net.createServer().listen(0, () => {
		const p = s.address().port;
		s.close(() => ok(p));
	});
});
async function answers(port) {
	const ok = await fetch(`http://127.0.0.1:${port}/api/setup`).then(r => r.ok && r.json(), () => null);
	return !!ok && (await fetch(`http://127.0.0.1:${port}/`)).ok;
}
async function tryStart(node, dir, app) {
	const data = `${DATA}/stage-data`;
	rm(data);
	fs.mkdirSync(data, { mode: 0o700 });
	for (const f of ['config.json', 'db.json']) {
		if (fs.existsSync(`${DATA}/${f}`)) fs.copyFileSync(`${DATA}/${f}`, `${data}/${f}`);
	}
	const port = await freePort();
	const p = spawn(node, [`${app}/server.mjs`], {
		cwd: dir,
		env: {
			...process.env,
			DATA_DIR: data,
			PORT: port,
			P1_TRIAL: '1',
		},
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	let out = '';
	p.stdout.on('data', d => out += d);
	p.stderr.on('data', d => out += d);
	try {
		for (let i = 0; i < 40; i++) {
			await new Promise(ok => setTimeout(ok, 500));
			if (p.exitCode != null) throw new Error(`staged server exited: ${out.slice(-500)}`);
			if (await answers(port)) return;
		}
		throw new Error(`staged server didn't answer: ${out.slice(-500)}`);
	} finally {
		p.kill('SIGKILL');
		rm(data);
	}
}

// --- the TV app: built here, from this checkout, for this server's public address ---
let tvBusy = false;
async function buildTv(dir, node, out) {
	const site = cfg().PUBLIC_URL;
	if (!site) throw new Error('no public address yet');
	rm(out);
	log('building the TV app for', site);
	await new Promise((ok, ko) => {
		const p = spawn('nice', ['-n', '19', node, 'tv/build.mjs', out], {
			cwd: dir,
			env: {
				...process.env,
				...cfg(),
				DATA_DIR: DATA,
			},
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		let err = '';
		p.stdout.on('data', d => process.stdout.write(d));
		p.stderr.on('data', d => err += d);
		p.on('exit', code => code ? ko(new Error(`TV build failed: ${err.slice(-600)}`)) : ok());
	});
}
// none yet, or built for another address: build it (the previous one stays until the new one is
// complete)
async function ensureTv(force) {
	const built = readJSON(`${DIST}/build.json`, null);
	const site = cfg().PUBLIC_URL;
	if (tvBusy || !site || (!force && built?.site === site.replace(/\/$/, ''))) return;
	tvBusy = true;
	save({ tv: 'building' });
	try {
		await buildTv(ROOT, process.execPath, `${DIST}.next`);
		swapIn(DIST);
		save({
			tv: 'ok',
			tvError: null,
		});
	} catch (err) {
		log(err.message);
		save({
			tv: 'failed',
			tvError: err.message.slice(0, 300),
		});
	} finally {
		tvBusy = false;
	}
}

// --- the LG TV (webOS) app: a launcher for the public address, quick to build anywhere ---
function ensureWebos() {
	try {
		sh(process.execPath, ['webos/build.mjs', `${DATA}/webos`], {
			env: {
				...process.env,
				...cfg(),
				DATA_DIR: DATA,
			},
		});
	} catch (err) {
		log('webOS app build failed:', err.stderr?.toString() || err.message);
	}
}

// --- updates ---
let busy = false;
const isAncestor = (a, b) => {
	try {
		git('merge-base', '--is-ancestor', a, b);
		return true;
	} catch {
		return false;
	}
};

/** why the commit asked for isn't installed, or null to install it */
function waitFor({ want, s, head, latest, next, testing }) {
	// a test commit stays until master moves on, another test comes, or want.public
	if (testing && !want.test && !want.public && s.test.base === latest) return 'testing';
	if (head === next) return testing ? 'testing' : 'latest';
	if (git('status', '--porcelain', '--untracked-files=no')) return 'local-changes';
	if (want.test) return null;
	if (s.bad === next) return 'rolled-back'; // waits for a newer commit
	if (!testing && !isAncestor(head, next)) return 'diverged'; // leaving a test commit needs no fast-forward
	return null;
}

/**
 * where master stands: null when there's nothing to install (the reason saved). want.test: a commit of
 * this repository to try (pushed here by its developer); want.public: back to master from one
 */
function whatsNew(want = {}) {
	try {
		git('remote', 'get-url', 'origin');
	} catch {
		return save({
			status: 'no-remote',
			error: null,
		}) && null;
	}
	try {
		git('fetch', '--quiet', 'origin', 'master');
	} catch (err) {
		return save({
			status: 'unreachable',
			error: err.stderr?.toString().split('\n')[0],
		}) && null;
	}
	const head = git('rev-parse', 'HEAD');
	const latest = git('rev-parse', 'origin/master');
	const s = save({
		checked: Date.now(),
		head,
		latest,
	});
	const testing = s.test?.sha === head;
	const next = want.test ? git('rev-parse', '--verify', `${want.test}^{commit}`) : latest;
	const status = waitFor({
		want,
		s,
		head,
		latest,
		next,
		testing,
	});
	if (status) return save({
		status,
		error: null,
	}) && null;
	return {
		head,
		next,
		s,
		jump: !!want.test || testing,
		test: want.test ? {
			sha: next,
			base: latest,
		} : null,
	};
}

/**
 * The stage folder and its entry in .git/worktrees, whatever state a stopped run left them in (--force twice: git
 * locks a worktree while it makes it). Never `git worktree prune`: in the container the repository is at /app, so
 * every worktree made on the host has a path that does not exist here, and prune would forget them all.
 */
function dropStage(stage) {
	rm(stage);
	try {
		git('worktree', 'remove', '--force', '--force', stage);
	} catch {
		// no worktree to forget
	}
}

/** the staged commit: built, checked, tried, then switched to */
async function install({ head, next, s, jump, test }, stage) {
	log('trying', next.slice(0, 7));
	save({ status: 'building' });
	dropStage(stage);
	git('worktree', 'add', '--detach', '--force', stage, next);
	const node = await nodeFor(stage);
	await build(stage, node, `${APP}.next`);
	await tryStart(node, stage, `${APP}.next`);
	const tv = !!git('diff', '--name-only', head, next, '--', 'tv') || s.tv === 'failed'
		|| !fs.existsSync(`${DIST}/player1.apk`);
	let newDist = false;
	if (tv) {
		try {
			await buildTv(stage, node, `${DIST}.next`);
			newDist = true;
		} catch (err) { // the server still updates
			log(err.message);
			save({
				tv: 'failed',
				tvError: err.message.slice(0, 300),
			});
		}
	}
	// switch
	save({
		prev: {
			head,
			node: state().node || null,
			dist: newDist,
		},
	});
	swapIn(APP);
	if (newDist) {
		swapIn(DIST);
		save({
			tv: 'ok',
			tvError: null,
		});
	}
	if (jump) git('reset', '--hard', '--quiet', next);
	else git('merge', '--ff-only', '--quiet', next);
	save({
		test,
		node: node === process.execPath ? null : node,
		trial: {
			sha: next,
			at: Date.now(),
		},
		status: 'trial',
		error: null,
	});
	log('updated', head.slice(0, 7), '→', next.slice(0, 7));
	ensureWebos();
	if (selfChanged(head, next)) {
		child?.kill('SIGTERM');
		process.exit(0);
	}
	restart();
}

async function update(want) {
	if (busy || cfg().UPDATES === 'off' || !fs.existsSync('.git')) return;
	busy = true;
	const stage = `${DATA}/stage`;
	try {
		const n = whatsNew(want);
		if (n) await install(n, stage);
	} catch (err) {
		log('failed:', err.message);
		save({
			status: 'failed',
			error: (err.stderr?.toString() || err.message).slice(-600),
		});
	} finally {
		busy = false;
		dropStage(stage);
	}
}

// --- first start: no build yet. A small page says so while this checkout is built. ---
const READY = '<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="5">'
	+ '<title>Player1</title><body style="background:#17121f;color:#f3eee6;font:18px system-ui;'
	+ 'display:grid;place-content:center;min-height:90vh">Player1 is getting ready…';
async function firstBuild() {
	const port = +(process.env.PORT || 6510);
	const page = http.createServer((req, res) => {
		if (req.url.startsWith('/api/')) {
			return res.writeHead(503, { 'content-type': 'application/json' }).end('{"error":"building"}');
		}
		res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(READY);
	}).listen(port, process.env.HOST || '0.0.0.0');
	try {
		await build(ROOT, process.execPath, `${APP}.next`, { quick: true });
		swapIn(APP);
	} finally {
		await new Promise(ok => page.close(ok));
	}
}

// older installs kept the TV app in tv/: it becomes the current build
if (!fs.existsSync(DIST) && fs.existsSync('tv/player1.apk') && fs.existsSync('tv/version')) {
	fs.mkdirSync(DIST, { recursive: true });
	for (const f of ['player1.apk', 'version']) fs.copyFileSync(`tv/${f}`, `${DIST}/${f}`);
	fs.writeFileSync(`${DIST}/build.json`, JSON.stringify({
		site: (cfg().PUBLIC_URL || '').replace(/\/$/, ''),
		version: +fs.readFileSync('tv/version', 'utf8'),
	}));
}
save({ supervised: true }); // the settings screen knows updates are handled
if (!fs.existsSync(`${APP}/server.mjs`)) {
	try {
		await firstBuild();
	} catch (err) {
		log('first build failed:', err.message);
		process.exit(1);
	}
}
start();
setTimeout(ensureTv, 5000);
ensureWebos();
setTimeout(update, 60e3);
setInterval(update, EVERY);
// the settings screen asks through a file: data/update.request = "update" (check now) or "tv"
// (rebuild the TV app); a developer's "test <commit>" (try that commit) or "public" (back to master)
setInterval(() => {
	const f = `${DATA}/update.request`;
	if (!fs.existsSync(f)) return;
	const what = fs.readFileSync(f, 'utf8').trim();
	rm(f);
	if (what === 'tv') ensureTv(true);
	else if (what.startsWith('test ')) update({ test: what.slice(5) });
	else update({ public: what === 'public' });
}, 5000);
