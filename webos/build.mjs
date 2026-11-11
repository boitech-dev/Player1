// Builds the LG TV (webOS) app, plain Node, no SDK:  node webos/build.mjs [out-dir]
// The app is a launcher: it opens the server's website (PUBLIC_URL, baked in when set; otherwise the app looks for
// Player1 on the TV's network, see index.html). Output: <out>/player1.ipk, the format webOS installs (the server's
// own install from Settings, ares-install, webOS Dev Manager, Homebrew Channel), <out>/repo.json, a Homebrew Channel
// repository holding that one app (the server offers it at /webos.json, so a TV with Homebrew Channel installs
// Player1 by itself), then <out>/build.json.
// An .ipk is an ar archive of debian-binary, control.tar.gz and data.tar.gz; the app's files go in
// usr/palm/applications/<id>/ and its package description in usr/palm/packages/<id>/.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const WEBOS = import.meta.dirname;
const DATA = path.resolve(process.env.DATA_DIR || 'data');
const OUT = path.resolve(process.argv[2] || `${DATA}/webos`);
const SITE = (process.env.PUBLIC_URL || '').replace(/\/$/, '');

const info = JSON.parse(fs.readFileSync(`${WEBOS}/appinfo.json`, 'utf8'));
const { id, version } = info;
const page = fs.readFileSync(`${WEBOS}/index.html`, 'utf8');
// the sizes webOS asks for (80 and 130 px), drawn from icons/icon-512.png
const icon = fs.readFileSync(`${WEBOS}/icon.png`);
const largeIcon = fs.readFileSync(`${WEBOS}/largeIcon.png`);
const app = `usr/palm/applications/${id}`, pkg = `usr/palm/packages/${id}`;
const files = {
	[`${app}/appinfo.json`]: JSON.stringify(info, null, '\t') + '\n',
	[`${app}/index.html`]: SITE ? page.replaceAll('__SITE__', SITE) : page,
	[`${app}/icon.png`]: icon,
	[`${app}/largeIcon.png`]: largeIcon,
	[`${pkg}/packageinfo.json`]: JSON.stringify({
		app: id, id, loc_name: info.title, package_format_version: 2, vendor: info.vendor, version,
	}, null, '\t') + '\n',
};

// --- tar (ustar), every entry owned by root ---
const now = Math.floor(Date.now() / 1000);
function header(name, size, dir) {
	const h = Buffer.alloc(512);
	const put = (at, len, s) => h.write(s, at, len, 'utf8');
	const oct = (at, len, n) => put(at, len, n.toString(8).padStart(len - 1, '0'));
	if (Buffer.byteLength(name) > 100) throw new Error(`path too long for tar: ${name}`);
	put(0, 100, name);
	oct(100, 8, dir ? 0o755 : 0o644);
	oct(108, 8, 0);
	oct(116, 8, 0);
	oct(124, 12, size);
	oct(136, 12, now);
	h.fill(' ', 148, 156); // checksum counted as spaces
	put(156, 1, dir ? '5' : '0');
	put(257, 8, 'ustar\x0000');
	put(265, 32, 'root');
	put(297, 32, 'root');
	let sum = 0;
	for (const b of h) sum += b;
	put(148, 8, sum.toString(8).padStart(6, '0') + '\0 ');
	return h;
}
function tgz(entries) {
	const parts = [], dirs = new Set();
	for (const [name, body] of Object.entries(entries)) {
		const segs = name.split('/');
		for (let i = 1; i < segs.length; i++) {
			const d = segs.slice(0, i).join('/');
			if (!dirs.has(d)) {
				dirs.add(d);
				parts.push(header(`${d}/`, 0, true));
			}
		}
		const data = Buffer.from(body);
		parts.push(header(name, data.length, false), data, Buffer.alloc((512 - data.length % 512) % 512));
	}
	parts.push(Buffer.alloc(1024));
	return zlib.gzipSync(Buffer.concat(parts), { level: 9 });
}

// --- ar ---
function ar(members) {
	const parts = [Buffer.from('!<arch>\n')];
	for (const [name, body] of members) {
		const data = Buffer.from(body), f = (s, n) => String(s).padEnd(n);
		// name, date, owner, group, mode, size
		const head = f(name, 16) + f(now, 12) + f(0, 6) + f(0, 6) + f(100644, 8) + f(data.length, 10);
		parts.push(Buffer.from(head + '`\n'));
		parts.push(data);
		if (data.length % 2) parts.push(Buffer.from('\n'));
	}
	return Buffer.concat(parts);
}

const size = Object.values(files).reduce((n, b) => n + Buffer.byteLength(b), 0);
const control = [
	`Package: ${id}`,
	`Version: ${version}`,
	'Section: misc',
	'Priority: optional',
	'Architecture: all',
	`Installed-Size: ${size}`,
	`Maintainer: ${info.vendor}`,
	`Description: ${info.title}`,
	'webOS-Package-Format-Version: 2',
	'webOS-Packager-Version: 1.0.0',
	'',
].join('\n');
const ipk = ar([
	['debian-binary', '2.0\n'],
	['control.tar.gz', tgz({ control })],
	['data.tar.gz', tgz(files)],
]);
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(`${OUT}/player1.ipk.part`, ipk);
fs.renameSync(`${OUT}/player1.ipk.part`, `${OUT}/player1.ipk`);
// Homebrew Channel reads the app from the repository itself (its manifest inline) and fetches the package from the
// address it found the repository at; it offers an update when the version changes
const about = 'Films and series from your own Player1 server, opened from its own icon.';
const iconUri = `data:image/png;base64,${largeIcon.toString('base64')}`;
fs.writeFileSync(`${OUT}/repo.json`, JSON.stringify({
	packages: [{
		id,
		title: info.title,
		iconUri,
		shortDescription: about,
		manifest: {
			id,
			version,
			type: info.type,
			title: info.title,
			appDescription: about,
			iconUri,
			rootRequired: false,
			ipkUrl: '/player1.ipk',
			ipkHash: { sha256: createHash('sha256').update(ipk).digest('hex') },
			ipkSize: ipk.length,
		},
	}],
}));
fs.writeFileSync(`${OUT}/build.json`, JSON.stringify({
	site: SITE,
	version,
}));
const what = SITE ? `for ${SITE}` : 'asks for the address';
console.log('webos build: done', `${OUT}/player1.ipk`, `(${id} ${version}, ${what})`);
