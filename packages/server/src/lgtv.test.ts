import { generateKeyPairSync } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';

import ssh2 from 'ssh2';
import {
	afterAll,
	beforeAll,
	expect,
	it,
	vi,
} from 'vitest';

// a stand-in for a TV in Developer Mode: the key server hands out an SSH key locked with the
// passphrase, the SSH server lets `prisoner` in with that key and plays the three commands
const PASS = 'A1B2C3';
const { privateKey } = generateKeyPairSync('rsa', {
	modulusLength: 2048,
	publicKeyEncoding: {
		type: 'spki',
		format: 'pem',
	},
	privateKeyEncoding: {
		type: 'pkcs1',
		format: 'pem',
		cipher: 'aes-128-cbc',
		passphrase: PASS,
	},
});
const host = generateKeyPairSync('rsa', {
	modulusLength: 2048,
	publicKeyEncoding: {
		type: 'spki',
		format: 'pem',
	},
	privateKeyEncoding: {
		type: 'pkcs1',
		format: 'pem',
	},
});
const allowed = ssh2.utils.parseKey(privateKey, PASS) as ssh2.ParsedKey;

const tv = {
	commands: [] as string[],
	received: Buffer.alloc(0),
	/** what the install service answers */
	answers: [] as object[],
};
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'p1-lgtv-'));
const ipk = Buffer.from('!<arch>\nnot a real package, only its bytes matter here');
const keys = http.createServer((req, res) => {
	if (req.url === '/webos_rsa') res.end(privateKey);
	else res.writeHead(404).end();
});
const sshd = new ssh2.Server({ hostKeys: [host.privateKey] }, client => {
	client.on('authentication', ctx => {
		const ok = ctx.method === 'publickey' && ctx.username === 'prisoner'
			&& ctx.key.data.equals(allowed.getPublicSSH());
		if (ok) ctx.accept();
		else ctx.reject(['publickey']);
	});
	client.on('ready', () => client.on('session', accept => accept().on('exec', (ok, _no, info) => {
		const stream = ok();
		tv.commands.push(info.command);
		if (info.command.includes('/bin/cat >')) {
			stream.on('data', (d: Buffer) => {
				tv.received = Buffer.concat([tv.received, d]);
			});
			stream.on('end', () => {
				stream.exit(0);
				stream.end();
			});
		} else if (info.command.includes('luna-send-pub')) {
			// the service keeps the subscription open: only the caller ends it
			for (const a of tv.answers) stream.write(JSON.stringify(a) + '\n');
		} else {
			stream.exit(0);
			stream.end();
		}
	})));
	client.on('error', () => undefined);
});
const ports = {
	key: 0,
	ssh: 0,
};
let installOnTv: typeof import('./lgtv.ts').installOnTv;
let installState: typeof import('./lgtv.ts').installState;

beforeAll(async () => {
	fs.mkdirSync(`${data}/webos`);
	fs.writeFileSync(`${data}/webos/player1.ipk`, ipk);
	vi.stubEnv('DATA_DIR', data);
	({ installOnTv, installState } = await import('./lgtv.ts'));
	await new Promise<void>(done => keys.listen(0, '127.0.0.1', done));
	await new Promise<void>(done => sshd.listen(0, '127.0.0.1', done));
	ports.key = (keys.address() as AddressInfo).port;
	ports.ssh = (sshd.address() as AddressInfo).port;
});
afterAll(() => {
	keys.close();
	sshd.close();
	fs.rmSync(data, { recursive: true });
});

it('copies the package to the TV and has it installed', async () => {
	tv.answers = [
		{
			returnValue: true, subscribed: true, 
		},
		{ details: { state: 'installing' } },
		{ details: { state: 'installed' } },
	];
	await installOnTv('127.0.0.1', PASS, ports);
	expect(tv.received.equals(ipk)).toBe(true);
	expect(tv.commands).toEqual([
		'/bin/mkdir -p /media/developer/temp && /bin/cat > /media/developer/temp/player1.ipk',
		'/usr/bin/luna-send-pub -i luna://com.webos.appInstallService/dev/install '
		+ '\'{"id":"dev.adriweb.player1","ipkUrl":"/media/developer/temp/player1.ipk","subscribe":true}\'',
		'/bin/rm -f /media/developer/temp/player1.ipk',
	]);
});

it('says so when the TV refuses the package', async () => {
	tv.answers = [{
		details: {
			state: 'FAILED_IPKG_INSTALL', reason: 'FAILED_IPKG_INSTALL', 
		}, 
	}];
	await expect(installOnTv('127.0.0.1', PASS, ports)).rejects.toThrow(/refused to install/);
});

it('tells a wrong passphrase from a TV that doesn’t answer', async () => {
	await expect(installOnTv('127.0.0.1', 'WRONG1', ports)).rejects.toThrow(/Wrong passphrase/);
	await expect(installOnTv('127.0.0.1', PASS, {
		...ports, key: 1, 
	})).rejects.toThrow(/doesn’t answer/);
	await expect(installOnTv('127.0.0.1', PASS, {
		...ports, ssh: 1, 
	})).rejects.toThrow(/Developer Mode/);
	await expect(installOnTv('tv; rm -rf /', PASS, ports)).rejects.toThrow(/address/);
});

it('reads the install service’s answers', () => {
	expect(installState('{"details":{"state":"installing"}}')).toBe('installing');
	expect(installState('not json')).toBe('');
	expect(() => installState('{"returnValue":false,"errorText":"Denied"}')).toThrow('Denied');
});
