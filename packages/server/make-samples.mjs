// The device test's clips: the same 8 seconds of a free film in the four formats a device is tested on
// (packages/shared/src/release.ts). The film is Sol Levante (© Netflix, CC BY 4.0), 24 fps like the films
// Player1 plays, from its SDR and HDR10 masters: https://opencontent.netflix.com/
//
// THIS ENCODES VIDEO. No server runs it: it was run once, by hand, and its four files are published as release
// files, which each server fetches at its first start (packages/server/src/samples.ts). To change the clips: run
// it where encoding is fine (ffmpeg with libx264, libx265, libsvtav1), publish the files under a new release
// name, and paste what it prints into samples.ts.
//   node packages/server/make-samples.mjs [work folder]     clips to data/samples/; the masters' 8 seconds (1.6 GB) stay in the work folder between runs
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';

const out = 'data/samples/', work = process.argv[2] || out + 'work/';
const MASTERS = 'http://download.opencontent.netflix.com.s3.amazonaws.com/SolLevante/';
const AT = 46, SECS = 8; // the forest: fine detail everywhere, which is what costs a decoder
const THREADS = 6;

// The bitrates are the test's difficulty: what a demanding release of each kind weighs.
const BT709 = ['-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709'];
const HD = 'scale=1920:1080:flags=lanczos,format=';
// HDR10 as a UHD Blu-ray carries it: BT.2020, PQ, a P3-D65 mastering display at 1000 nits
const HDR10 = 'hdr10=1:hdr10-opt=1:repeat-headers=1'
	+ ':colorprim=bt2020:transfer=smpte2084:colormatrix=bt2020nc:max-cll=1000,400'
	+ ':master-display=G(13250,34500)B(7500,3000)R(34000,16000)WP(15635,16450)L(10000000,50)';
const SETS = [
	{
		key: 'h264', name: 'H.264 1080p, débit Blu-ray', master: 'sdr', video: [
			'-vf', HD + 'yuv420p', '-c:v', 'libx264', '-preset', 'slow', '-profile:v', 'high', '-level', '4.1',
			'-b:v', '30M', '-maxrate', '40M', '-bufsize', '30M', '-g', 48, '-bf', 3, ...BT709,
		],
	},
	{
		key: 'hevc10', name: 'HEVC 10 bits 1080p', master: 'sdr', video: [
			'-vf', HD + 'yuv420p10le', '-c:v', 'libx265', '-preset', 'medium', '-b:v', '8M',
			'-x265-params', `vbv-maxrate=12000:vbv-bufsize=12000:keyint=48:pools=${THREADS}:log-level=error`, ...BT709,
		],
	},
	{
		key: '4k', name: 'HEVC 10 bits 4K HDR', master: 'hdr', video: [
			'-vf', 'format=yuv420p10le', '-c:v', 'libx265', '-preset', 'medium', '-b:v', '25M', '-x265-params',
			`${HDR10}:level-idc=5.1:vbv-maxrate=40000:vbv-bufsize=40000:keyint=48:pools=${THREADS}:log-level=error`,
		],
	},
	{
		key: 'av1', name: 'AV1 1080p', master: 'sdr', video: [
			'-vf', HD + 'yuv420p10le', '-c:v', 'libsvtav1', '-preset', 6, '-b:v', '4M', '-g', 48,
			'-svtav1-params', `lp=${THREADS}`, ...BT709,
		],
	},
];

const ffmpeg = args => execFileSync(
	'nice', ['-n', '19', 'ffmpeg', '-v', 'error', '-y', ...args.map(String)], { stdio: 'inherit' },
);
const probe = file => JSON.parse(execFileSync('ffprobe', [
	'-v', 'error', '-of', 'json', '-select_streams', 'v:0', '-show_entries',
	'stream=codec_name,profile,level,width,height,pix_fmt,r_frame_rate', file,
])).streams[0];
// what the browser is asked before it tries (VideoDecoder.isConfigSupported)
const codecString = s => {
	if (s.codec_name === 'h264') return 'avc1.6400' + s.level.toString(16).padStart(2, '0');
	if (s.codec_name === 'hevc') return `hvc1.2.4.L${s.level}.90`;
	return `av01.0.${s.level.toString().padStart(2, '0')}M.10`;
};

// the masters' 8 seconds, by stream copy: ProRes, every frame a keyframe, so the cut is exact
fs.mkdirSync(work, { recursive: true });
const cut = (name, from, maps) => {
	if (fs.existsSync(work + name)) return;
	ffmpeg([
		'-ss', AT, '-i', MASTERS + from, '-t', SECS, ...maps, '-c', 'copy', '-f', 'mov', work + name + '.part',
	]);
	fs.renameSync(work + name + '.part', work + name); // whole, or not there
};
cut('sdr.mov', 'sdr/SolLevante_SDR_UHD_24fps.mov', ['-map', '0:v:0']);
const HDR = 'hdr10/SolLevante_HDR10_r2020_ST2084_UHD_24fps_1000nit.mov';
cut('hdr.mov', HDR, ['-map', '0:v:0', '-map', '0:a:0']); // with its 5.1 mix

const clips = [];
for (const x of SETS) {
	const file = `${out}${x.key}.mkv`;
	ffmpeg([ // the sound every clip gets: AC-3 5.1, the most common in releases
		'-i', `${work}${x.master}.mov`, '-i', work + 'hdr.mov', '-map', '0:v:0', '-map', '1:a:0', '-threads', THREADS,
		...x.video, '-c:a', 'ac3', '-b:a', '640k', '-map_metadata', -1,
		'-metadata', 'title=Sol Levante (excerpt) © Netflix, CC BY 4.0', '-f', 'matroska', file,
	]);
	const s = probe(file), [n, d] = s.r_frame_rate.split('/').map(Number), buf = fs.readFileSync(file);
	clips.push({
		key: x.key, name: x.name, codec: codecString(s), width: s.width, height: s.height, fps: n / d,
		bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex'),
	});
	console.error(x.key, `${(buf.length * 8 / SECS / 1e6).toFixed(1)} Mbit/s`);
}
console.log(JSON.stringify(clips, null, '\t')); // for CLIPS in packages/server/src/samples.ts
