import {
	describe,
	expect,
	it,
} from 'vitest';

import {
	fitsEp,
	parseTorznab,
	videoFile,
} from './torznab.ts';

const xml = `<rss><channel><item><title>Dune.Part.Two.2024.MULTi.VFF.1080p.BluRay.x264-FOO</title>
<guid>https://c411.org/torrents/123</guid><comments>https://c411.org/torrents/123</comments><size>9876543210</size>
<pubDate>Tue, 05 Mar 2024 10:00:00 +0000</pubDate><enclosure url="https://c411.org/api/torznab?t=get&amp;id=123&amp;apikey=K" length="9876543210" type="application/x-bittorrent"/>
<torznab:attr name="seeders" value="42"/><torznab:attr name="peers" value="50"/>
<torznab:attr name="grabs" value="900"/><torznab:attr name="infohash" value="ABCDEF"/>
</item></channel></rss>`;

describe('a Torznab answer', () => {
	it('gives each release its name, link, size and peers', () => {
		const [r] = parseTorznab(xml);
		expect(r?.title).toBe('Dune.Part.Two.2024.MULTi.VFF.1080p.BluRay.x264-FOO');
		expect(r?.download).toBe('https://c411.org/api/torznab?t=get&id=123&apikey=K');
		expect([r?.size, r?.seeders, r?.leechers, r?.grabs, r?.hash])
			.toEqual([9876543210, 42, 8, 900, 'abcdef']);
	});
});

describe('a series release fits an episode', () => {
	it('by episode, range, season pack, multi-season pack or full series', () => {
		expect(fitsEp('Show.S02E05.FRENCH.1080p', 2, 5)).toBe(true);
		expect(fitsEp('Show.S02E05.FRENCH.1080p', 2, 6)).toBe(false);
		expect(fitsEp('Show.S02E01-E10.MULTi', 2, 7)).toBe(true);
		expect(fitsEp('Show.S02.MULTi.1080p', 2, 7)).toBe(true);
		expect(fitsEp('Show.S03.MULTi.1080p', 2, 7)).toBe(false);
		expect(fitsEp('Show.S01-S05.MULTi', 4, 1)).toBe(true);
		expect(fitsEp('Show.Integrale.MULTi', 4, 1)).toBe(true);
		expect(fitsEp('Show.MULTi.1080p', 4, 1)).toBe(false);
	});
});

describe('the video file of a torrent', () => {
	it('is the episode by name, else the e-th video, else the biggest for a film', () => {
		const files = [
			{
				id: 1,
				path: '/Show/Show.S01E02.mkv',
				bytes: 9,
			},
			{
				id: 2,
				path: '/Show/Show.S01E01.mkv',
				bytes: 9,
			},
			{
				id: 3,
				path: '/Show/sample.mkv',
				bytes: 1,
			},
			{
				id: 4,
				path: '/Show/info.nfo',
				bytes: 1,
			},
		];
		expect(videoFile(files, 1, 2)?.id).toBe(1);
		expect(videoFile([
			{
				id: 5,
				path: '/A/[Grp] A - 01.mkv',
				bytes: 1,
			},
			{
				id: 6,
				path: '/A/[Grp] A - 02.mkv',
				bytes: 1,
			},
		], 1, 2)?.id).toBe(6);
		expect(videoFile([
			{
				id: 7,
				path: '/M/m.mkv',
				bytes: 9,
			},
			{
				id: 8,
				path: '/M/sample.mkv',
				bytes: 1,
			},
		])?.id).toBe(7);
	});
});
