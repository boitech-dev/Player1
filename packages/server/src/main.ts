// Player1: browse TMDB+Cinemeta, find sources via a Stremio stream addon (Torrentio+RD), play
// through RD's HLS transcoder, or the original file with the device's own decoder.
import './config.ts'; // first: fills process.env
import './dns.ts'; // before any request: public resolver first

import http from 'node:http';

import {
	catalogGets,
	markAll,
} from './catalog.ts';
import {
	configured,
	setupToken,
} from './config.ts';
import {
	deviceGets,
	devicePosts,
	ping,
} from './devices.ts';
import {
	downloadGets,
	downloadPosts,
	startDownloads,
} from './downloads.ts';
import {
	householdGets,
	householdPosts,
} from './household.ts';
import { handler } from './http.ts';
import {
	followAll,
	playPosts,
} from './play.ts';
import { fetchClips } from './samples.ts';
import { sourceGets } from './sources.ts';
import { sweepTrailers } from './trailers.ts';

const PORT = Number(process.env.PORT) || 6510;

// files and folders written to the NFS library stay deletable by the drive's owner
process.umask(0);
// P1_TRIAL: run.mjs trying an update on a copy of the data, no background work
if (!process.env.P1_TRIAL) {
	startDownloads();
	void fetchClips(); // the device test's clips, the first time
	void followAll(); // episodes finished on a version that didn't note the one after
	void sweepTrailers(); // and daily: trailer files unused for 30 days, yt-dlp's update
	setInterval(() => void sweepTrailers(), 864e5);
	void markAll(); // "seen" verdicts given before Discover kept the card
}
setInterval(ping, 25e3); // keep proxies from closing idle SSE

const routes = {
	gets: {
		...householdGets,
		...catalogGets,
		...sourceGets,
		...downloadGets,
		...deviceGets,
	},
	posts: {
		...householdPosts,
		...playPosts,
		...downloadPosts,
		...devicePosts,
	},
};
http.createServer(handler(routes)).listen(PORT, process.env.HOST || '0.0.0.0', () => {
	console.log(`player1 on :${PORT}`);
	if (!configured()) console.log(`setup: open http://<this server>:${PORT}/?setup=${setupToken()}`);
});
