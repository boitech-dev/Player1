// Every outgoing request looks names up at a public resolver first: ISP resolvers block torrent
// sites (c411.org in France). Names it doesn't know (jellyfin.lan, a router's names) or can't
// answer go to this machine's usual lookup.
// ponytail: no cache, one query per new connection; add one if lookups ever show in timings
import dns from 'node:dns';
import net from 'node:net';

type Cb = (
	err: NodeJS.ErrnoException | null,
	address: string | dns.LookupAddress[],
	family?: number,
) => void;

export function publicFirst(sys: typeof dns.lookup) {
	const pub = new dns.Resolver({
		timeout: 2000,
		tries: 1,
	});
	pub.setServers(['1.1.1.1', '9.9.9.9']);
	return ((host: string, opts: dns.LookupOptions | number | Cb, cb: Cb) => {
		if (typeof opts === 'function') [cb, opts] = [opts, {}];
		const o: dns.LookupOptions = typeof opts === 'number' ? { family: opts } : opts;
		const usual = () => (sys as (h: string, o: dns.LookupOptions, cb: Cb) => void)(host, o, cb);
		// addresses, names without a dot (localhost), IPv6 only: the usual lookup
		if (net.isIP(host) || !host.includes('.') || o.family === 6 || o.family === 'IPv6') return usual();
		pub.resolve4(host, (err, ips) => {
			const ip = err ? undefined : ips[0]; // ips is undefined on an error
			if (!ip) return usual();
			if (o.all) cb(null, ips.map(address => ({
				address,
				family: 4,
			})));
			else cb(null, ip, 4);
		});
	}) as typeof dns.lookup;
}

dns.lookup = publicFirst(dns.lookup);
