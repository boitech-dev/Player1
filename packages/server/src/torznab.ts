// Torznab indexers (C411, Prowlarr, Jackett…): parse search answers and match series releases to
// an episode.
const unxml = (s = '') => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
	.replace(/&lt;/g, '<')
	.replace(/&gt;/g, '>')
	.replace(/&quot;/g, '"')
	.replace(/&#39;|&apos;/g, '\'')
	.replace(/&amp;/g, '&');
const tag = (x: string, n: string) => unxml(new RegExp(`<${n}>([\\s\\S]*?)</${n}>`).exec(x)?.[1]);
const attr = (x: string, n: string) => new RegExp(`name="${n}"\\s+value="([^"]*)"`).exec(x)?.[1];

/** one release of a Torznab answer */
export interface TorznabItem {
	title: string;
	guid: string;
	details: string;
	download: string;
	size: number;
	date: string;
	seeders: number;
	leechers: number;
	grabs: number;
	hash?: string;
	free: boolean;
}

export const parseTorznab = (xml: string) => [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)]
	.map(([, x = '']): TorznabItem => {
		const seeders = +(attr(x, 'seeders') || 0);
		return {
			title: tag(x, 'title'),
			guid: tag(x, 'guid'),
			details: tag(x, 'comments') || tag(x, 'link'),
			download: unxml(/<enclosure[^>]*url="([^"]*)"/.exec(x)?.[1]),
			size: +(tag(x, 'size') || attr(x, 'size') || 0),
			date: tag(x, 'pubDate'),
			seeders,
			leechers: Math.max(0, +(attr(x, 'peers') || seeders) - seeders),
			grabs: +(attr(x, 'grabs') || 0),
			hash: attr(x, 'infohash')?.toLowerCase(),
			free: attr(x, 'downloadvolumefactor') === '0',
		};
	});

// does this release contain season s, episode e? Episode, episode range, season pack,
// multi-season pack, or full series
export function fitsEp(t: string, s: number, e: number) {
	const ep = /\bS(\d{1,2})[ .]?E(\d{1,4})(?:-?E?(\d{1,4}))?\b/i.exec(t);
	if (ep) return +ep[1]! === s && e >= +ep[2]! && e <= +(ep[3] || ep[2]!);
	const ss = /\bS(\d{1,2})(?:-S?(\d{1,2}))?\b/i.exec(t);
	if (ss) return s >= +ss[1]! && s <= +(ss[2] || ss[1]!);
	return /int[ée]grale|complete/i.test(t);
}

/** a file of a torrent */
export interface TorrentFile {
	id: number;
	path: string;
	bytes: number;
}

// which file of a torrent is the episode: SxxEyy in its name, else (ponytail: anime packs with
// absolute numbers) the e-th video file by name in a single-season pack
/** an episode in a file name: S01E02, 1x02 */
export const epRe = (s?: number, e?: number) => {
	return new RegExp(`S0*${s}[ .]?E0*${e}(?!\\d)|\\b0*${s}x0*${e}\\b`, 'i');
};
const VIDEO = /\.(mkv|mp4|avi|m4v|webm)$/i;
export function videoFile(files: TorrentFile[], s?: number | false, e = 0) {
	const vids = files.filter(f => VIDEO.test(f.path) && !/sample|extras?\//i.test(f.path));
	if (!s) return vids.sort((a, b) => b.bytes - a.bytes)[0];
	const ep = epRe(s, e);
	return vids.find(f => ep.test(f.path))
		|| vids.sort((a, b) => a.path.localeCompare(b.path))[e - 1];
}
