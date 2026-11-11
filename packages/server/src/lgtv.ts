// Installs the LG TV app on a TV in Developer Mode, from here, the way LG's own ares-install does
// (so nobody needs LG's tools on a computer): the TV's Developer Mode app hands out an SSH key
// (Key Server on, http://<tv>:9991/webos_rsa) locked with the passphrase it shows; with it, the
// package is copied over SSH (port 9922, user prisoner) and given to the TV's install service.
import fs from 'node:fs';

import { msg } from '@lingui/core/macro';
import { Client } from 'ssh2';

import { DATA } from './config.ts';
import { UserError } from './i18n.ts';

/** the TV's ports; only a test's fake TV has others */
export interface TvPorts {
	key: number;
	ssh: number;
}
const PORTS: TvPorts = {
	key: 9991,
	ssh: 9922,
};
const TEMP = '/media/developer/temp';
const INSTALL = 'luna://com.webos.appInstallService/dev/install';

async function tvKey(host: string, port: number) {
	try {
		const r = await fetch(`http://${host}:${port}/webos_rsa`, { signal: AbortSignal.timeout(6000) });
		if (r.ok) return await r.text();
	} catch { /* said below */ }
	throw new UserError(msg`The TV doesn’t answer at this address. Check the address, that the TV is on, and that Key Server is on in its Developer Mode app.`);
}

function connect(host: string, port: number, privateKey: string, passphrase: string) {
	return new Promise<Client>((resolve, reject) => {
		const ssh = new Client();
		ssh.on('ready', () => resolve(ssh));
		ssh.on('error', (err: Error & { level?: string }) => reject(err.level === 'client-authentication'
			? new UserError(msg`The TV refused the connection. Turn Key Server off and on again in its Developer Mode app, then retry.`)
			: new UserError(msg`The TV doesn’t accept connections. Check that Developer Mode is on.`)));
		try {
			ssh.connect({
				host,
				port,
				username: 'prisoner',
				privateKey,
				passphrase,
				readyTimeout: 15000,
				// older TVs only know the first one (the list ares-install uses)
				algorithms: {
					kex: [
						'diffie-hellman-group1-sha1',
						'ecdh-sha2-nistp256',
						'ecdh-sha2-nistp384',
						'ecdh-sha2-nistp521',
						'diffie-hellman-group-exchange-sha256',
						'diffie-hellman-group14-sha1',
					],
				},
			});
		} catch { // the key didn't open
			reject(new UserError(msg`Wrong passphrase. Type the 6 characters the TV’s Developer Mode app shows, capitals included.`));
		}
	});
}

/** runs a command on the TV: its output, fed line by line to `each` (which may end it early) */
function run(ssh: Client, cmd: string, input?: Buffer, each?: (line: string) => boolean) {
	return new Promise<string>((resolve, reject) => {
		ssh.exec(cmd, (err, stream) => {
			if (err) return reject(err);
			let out = '', rest = '';
			const timer = setTimeout(() => stream.close(), 120e3);
			stream.on('data', (d: Buffer) => {
				out += d.toString();
				if (!each) return;
				const lines = (rest + d.toString()).split(/\r?\n/);
				rest = lines.pop() ?? '';
				if (lines.some(each)) stream.close();
			});
			stream.stderr.on('data', (d: Buffer) => {
				out += d.toString();
			});
			stream.on('close', () => {
				clearTimeout(timer);
				resolve(out);
			});
			stream.end(input);
		});
	});
}

/** the state in one line of the install service's answers; throws when it says it failed */
export function installState(line: string) {
	let r: { returnValue?: boolean; errorText?: string; details?: { state?: string; reason?: string } };
	try {
		r = JSON.parse(line) as typeof r;
	} catch {
		return '';
	}
	const state = r.details?.state ?? '';
	if (r.returnValue === false || /FAILED/i.test(state)) {
		throw new Error(r.details?.reason ?? r.errorText ?? (state || 'refused'));
	}
	return state;
}

/** copies data/webos/player1.ipk to the TV and installs it */
export async function installOnTv(host: string, code: string, ports = PORTS) {
	if (!/^[\w.-]{1,253}$/.test(host)) throw new UserError(msg`This isn’t a TV’s address. It looks like 192.168.1.42.`);
	const ipk = fs.readFileSync(`${DATA}/webos/player1.ipk`);
	const key = await tvKey(host, ports.key);
	const ssh = await connect(host, ports.ssh, key, code);
	const file = `${TEMP}/player1.ipk`;
	try {
		await run(ssh, `/bin/mkdir -p ${TEMP} && /bin/cat > ${file}`, ipk);
		let done = false, why = '';
		const param = JSON.stringify({
			id: 'dev.adriweb.player1',
			ipkUrl: file,
			subscribe: true,
		});
		const out = await run(ssh, `/usr/bin/luna-send-pub -i ${INSTALL} '${param}'`, undefined, line => {
			try {
				done ||= /installed|^SUCCESS/i.test(installState(line));
			} catch (err) {
				why = (err as Error).message;
			}
			return done || !!why;
		});
		await run(ssh, `/bin/rm -f ${file}`);
		if (!done) {
			console.error('LG TV install:', why || out.slice(-500));
			throw new UserError(msg`The TV refused to install the app. Check that Developer Mode is still on, then retry.`);
		}
	} finally {
		ssh.end();
	}
}
