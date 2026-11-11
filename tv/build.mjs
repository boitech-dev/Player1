// Builds the Android TV app on this server, no Gradle, no Docker:  node tv/build.mjs [out-dir]
// The toolchain (Temurin JDK, Android build tools and platform, the player libraries of deps.lock) is downloaded once
// into <data>/runtime and checked against published checksums. The app is signed with <data>/tv.keystore (made on first build,
// kept forever: Android only installs updates signed with the same key) and talks to PUBLIC_URL.
// Output: <out>/player1.apk, then <out>/version (written last: installed apps update once it changes).
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const TV = path.dirname(new URL(import.meta.url).pathname);
const DATA = path.resolve(process.env.DATA_DIR || 'data'), RT = `${DATA}/runtime`;
const OUT = path.resolve(process.argv[2] || `${DATA}/dist`);
const SITE = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
const JDK = 25, BUILD_TOOLS = '37.0.0', PLATFORM = 'android-37.2';
// straight from Google's SDK repository (repository2-3.xml gives these sha1): sdkmanager now fetches a separate CLI that
// reports usage by default, and is only a downloader
const SDK_ZIPS = {
	[`build-tools/${BUILD_TOOLS}`]: [
		'build-tools_r37_linux.zip', '70954e99f4c3d9d46ee70fa32624672fe7cd6ebe',
	],
	[`platforms/${PLATFORM}`]: [
		'platform-37.2_r02.zip', 'd52b3062af96f7c4dfdca5a479cd1db33ae83762',
	],
};
if (!SITE) throw new Error('PUBLIC_URL is not set: the TV app needs the address it connects to');
if (process.arch !== 'x64') {
	throw new Error(
		'Android build tools only exist for x86-64 Linux: the TV app can’t be built on this server',
	);
}

const log = (...a) => console.log('tv build:', ...a);
const hash = (f, sum) => crypto.createHash(sum.length === 40 ? 'sha1' : 'sha256')
	.update(fs.readFileSync(f)).digest('hex');
async function download(url, file, sum) {
	if (fs.existsSync(file) && hash(file, sum) === sum) return file;
	const r = await fetch(url);
	if (!r.ok) throw new Error(`${r.status} ${url}`);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file + '.part', Buffer.from(await r.arrayBuffer()));
	if (hash(file + '.part', sum) !== sum) {
		fs.rmSync(file + '.part');
		throw new Error(`checksum mismatch: ${url}`);
	}
	fs.renameSync(file + '.part', file); return file;
}
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, {
	stdio: ['pipe', 'pipe', 'inherit'], maxBuffer: 1e8, ...opts, env: {
		...process.env, JAVA_HOME: java, PATH: `${java}/bin:${process.env.PATH}`, ...opts.env, 
	}, 
}).toString();

// --- toolchain ---
// JDK: the latest Temurin of this major version, checksum from Adoptium
const jdkUrl = `https://api.adoptium.net/v3/assets/latest/${JDK}/hotspot`
	+ '?architecture=x64&image_type=jdk&os=linux&vendor=eclipse';
const jdkInfo = (await (await fetch(jdkUrl)).json())[0];
const java = `${RT}/jdk-${jdkInfo.version.semver}`;
if (!fs.existsSync(`${java}/bin/javac`)) {
	log('JDK', jdkInfo.version.semver);
	const jdkPkg = jdkInfo.binary.package;
	const tgz = await download(jdkPkg.link, `${RT}/dl/${jdkPkg.name}`, jdkPkg.checksum);
	fs.mkdirSync(java + '.tmp', { recursive: true });
	execFileSync('tar', ['-xzf', tgz, '-C', java + '.tmp', '--strip-components=1']);
	fs.renameSync(java + '.tmp', java);
	fs.rmSync(tgz);
}
// Android SDK: the build tools and the platform (Android SDK licence: https://developer.android.com/studio/terms)
const SDK = `${RT}/android-sdk`, BT = `${SDK}/build-tools/${BUILD_TOOLS}`, JAR = `${SDK}/platforms/${PLATFORM}/android.jar`;
for (const [dir, [zip, sum]] of Object.entries(SDK_ZIPS)) {
	if (fs.existsSync(`${SDK}/${dir}`)) continue;
	log('Android SDK', dir);
	const zipUrl = `https://dl.google.com/android/repository/${zip}`;
	const f = await download(zipUrl, `${RT}/dl/${zip}`, sum), tmp = `${SDK}/${dir}.tmp`;
	fs.rmSync(tmp, {
		recursive: true, force: true, 
	}); fs.mkdirSync(tmp, { recursive: true }); run('jar', ['xf', f], { cwd: tmp });
	const [top] = fs.readdirSync(tmp);
	fs.renameSync(`${tmp}/${top}`, `${SDK}/${dir}`);
	fs.rmSync(tmp, { recursive: true });
	fs.rmSync(f);
}
// jar keeps no exec bits
for (const f of fs.readdirSync(BT)) {
	if (!/\./.test(f) || f.endsWith('.so')) fs.chmodSync(`${BT}/${f}`, 0o755);
}
const libs = fs.readdirSync(`${BT}/lib64`, { recursive: true }).filter(f => f.endsWith('.so'));
for (const f of libs) fs.chmodSync(`${BT}/lib64/${f}`, 0o755);
// player libraries: exactly the files of deps.lock
const deps = [];
for (const line of fs.readFileSync(`${TV}/deps.lock`, 'utf8').split('\n')) {
	const [url, sum] = line.split(' ');
	if (!/^https:/.test(url || '')) continue;
	deps.push(await download(url, `${RT}/tv-deps/${url.split('/').pop()}`, sum));
}

// --- build ---
// minutes since epoch: always increasing, fits in versionCode
const VERSION = Math.floor(Date.now() / 60e3);
const W = `${RT}/tv-build`; fs.rmSync(W, {
	recursive: true, force: true, 
});
for (const d of ['src', 'classes', 'gen', 'jars', 'apk/lib', 'aar']) {
	fs.mkdirSync(`${W}/${d}`, { recursive: true });
}
log('building', VERSION, 'for', SITE);
const mainJava = fs.readFileSync(`${TV}/src/dev/adriweb/player1/Main.java`, 'utf8');
fs.writeFileSync(
	`${W}/src/Main.java`,
	mainJava.replace('__SITE__', SITE).replaceAll('__VERSION__', VERSION),
);
const manifest = fs.readFileSync(`${TV}/AndroidManifest.xml`, 'utf8');
fs.writeFileSync(`${W}/AndroidManifest.xml`, manifest.replaceAll('__VERSION__', VERSION));
// libraries: plain jars as they are; from each .aar its code, its resources (and their R package), and native code for ARM TVs
const pkgs = [], res = [];
for (const f of deps) {
	const n = path.basename(f).replace(/\.(aar|jar)$/, '');
	if (f.endsWith('.jar')) { fs.copyFileSync(f, `${W}/jars/${n}.jar`); continue; }
	const d = `${W}/aar/${n}`; fs.mkdirSync(d); run('jar', ['xf', f], { cwd: d });
	if (fs.existsSync(`${d}/classes.jar`)) fs.copyFileSync(`${d}/classes.jar`, `${W}/jars/${n}.jar`);
	if (fs.existsSync(`${d}/res`) && fs.readdirSync(`${d}/res`).length) {
		run(`${BT}/aapt2`, ['compile', '--dir', `${d}/res`, '-o', `${W}/res-${n}.zip`]);
		res.push(`${W}/res-${n}.zip`);
		const aarManifest = fs.readFileSync(`${d}/AndroidManifest.xml`, 'utf8');
		pkgs.push(/package="([^"]*)"/.exec(aarManifest)[1]);
	}
	for (const abi of ['arm64-v8a', 'armeabi-v7a']) {
		if (fs.existsSync(`${d}/jni/${abi}`)) {
			fs.cpSync(`${d}/jni/${abi}`, `${W}/apk/lib/${abi}`, { recursive: true });
		}
	}
}
run(`${BT}/aapt2`, ['compile', '--dir', `${TV}/res`, '-o', `${W}/res.zip`]);
run(`${BT}/aapt2`, [
	'link', '-o', `${W}/base.apk`, '-I', JAR, '--manifest', `${W}/AndroidManifest.xml`,
	'--java', `${W}/gen`, '--auto-add-overlay',
	'--extra-packages', pkgs.join(':'), `${W}/res.zip`, ...res,
]);
const jars = fs.readdirSync(`${W}/jars`).map(j => `${W}/jars/${j}`);
const gen = fs.readdirSync(`${W}/gen`, { recursive: true })
	.filter(f => f.endsWith('.java')).map(f => `${W}/gen/${f}`);
run('javac', [
	'--release', '11', '-nowarn', '-cp', [JAR, ...jars].join(':'), '-d', `${W}/classes`,
	`${W}/src/Main.java`, ...gen,
]);
const classes = fs.readdirSync(`${W}/classes`, { recursive: true })
	.filter(f => f.endsWith('.class')).map(f => `${W}/classes/${f}`);
run(`${BT}/d8`, ['--min-api', '23', '--lib', JAR, '--output', W, ...classes, ...jars]);
fs.copyFileSync(`${W}/base.apk`, `${W}/unsigned.apk`);
const dexFiles = fs.readdirSync(W).filter(f => /^classes\d*\.dex$/.test(f));
run('jar', ['uf', `${W}/unsigned.apk`, ...dexFiles], { cwd: W });
run('jar', ['uf', `${W}/unsigned.apk`, 'lib'], { cwd: `${W}/apk` });
run(`${BT}/zipalign`, ['-f', '4', `${W}/unsigned.apk`, `${W}/aligned.apk`]);
// signing key: made once per server, never replaced (older installs kept theirs in tv/)
const KS = `${DATA}/tv.keystore`;
if (!fs.existsSync(KS) && fs.existsSync(`${TV}/player1.keystore`)) {
	fs.copyFileSync(`${TV}/player1.keystore`, KS);
}
if (!fs.existsSync(KS)) {
	run('keytool', [
		'-genkeypair', '-keystore', KS, '-storepass', 'player1', '-keypass', 'player1',
		'-alias', 'p1', '-keyalg', 'RSA', '-validity', '36500', '-dname', 'CN=player1',
	]);
}
fs.mkdirSync(OUT, { recursive: true });
run(`${BT}/apksigner`, [
	'sign', '--ks', KS, '--ks-pass', 'pass:player1', '--out', `${OUT}/player1.apk`,
	`${W}/aligned.apk`,
]);
fs.rmSync(`${OUT}/player1.apk.idsig`, { force: true });
fs.writeFileSync(`${OUT}/build.json`, JSON.stringify({
	site: SITE, version: VERSION, 
}));
fs.writeFileSync(`${OUT}/version`, String(VERSION)); // last
fs.rmSync(W, {
	recursive: true, force: true, 
});
log('done', `${OUT}/player1.apk`, (fs.statSync(`${OUT}/player1.apk`).size / 1e6).toFixed(1), 'MB');
