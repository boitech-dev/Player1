import { touch } from '../lib/device.ts';

// Arrow keys move focus to the nearest control in that direction: TV remotes and keyboards behave
// the same everywhere. Runs after the player's own keys (they preventDefault what they handle).

const DIRS: Record<string, [number, number]> = {
	ArrowLeft: [-1, 0],
	ArrowRight: [1, 0],
	ArrowUp: [0, -1],
	ArrowDown: [0, 1],
};

function scope(): ParentNode {
	const sheet = document.querySelector<HTMLDialogElement>('#sheet');
	if (sheet?.open) return sheet;
	const player = document.querySelector('#player');
	return player?.hasAttribute('data-open') ? player : document;
}

const CONTROLS = 'a[href], button, input, [tabindex="0"]';
const focusable = (root: ParentNode) => [...root.querySelectorAll<HTMLElement>(CONTROLS)]
	.filter(el => !(el as HTMLButtonElement).disabled && el.getClientRects().length
		&& getComputedStyle(el).visibility !== 'hidden');

/** how far el is from the focused rect r, going dir; Infinity when it isn't that way */
function distance(r: DOMRect, el: HTMLElement, dir: [number, number]) {
	const q = el.getBoundingClientRect();
	const dx = q.left + q.width / 2 - (r.left + r.width / 2);
	const dy = q.top + q.height / 2 - (r.top + r.height / 2);
	const along = dx * dir[0] + dy * dir[1];
	if (along <= 1) return Infinity;
	if (dir[0] && !(q.top < r.bottom && q.bottom > r.top)) return Infinity; // left/right stay on the line
	const overlaps = q.left < r.right && q.right > r.left;
	const apart = Math.min(Math.abs(q.left - r.right), Math.abs(r.left - q.right));
	const gap = dir[0] || overlaps ? 0 : apart;
	return along + gap * 2;
}

function nearest(a: HTMLElement, all: HTMLElement[], dir: [number, number]) {
	const r = a.getBoundingClientRect();
	let best: HTMLElement | undefined;
	let score = Infinity;
	for (const el of all) {
		if (el === a || a.contains(el) || el.contains(a)) continue;
		const d = distance(r, el, dir);
		if (d < score) {
			score = d;
			best = el;
		}
	}
	return best;
}

const typing = (a: Element | null, dir: [number, number]) =>
	a instanceof HTMLInputElement && !a.readOnly && dir[1] === 0; // left/right move the caret

addEventListener('keydown', e => {
	const dir = DIRS[e.key];
	if (!dir || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
	const a = document.activeElement as HTMLElement | null;
	if (typing(a, dir)) return;
	const root = scope();
	const all = focusable(root);
	if (!a || a === document.body || !root.contains(a)) {
		all.find(el => el.getBoundingClientRect().top > 0)?.focus();
		return e.preventDefault();
	}
	const best = nearest(a, all, dir);
	if (!best) return;
	best.focus();
	best.scrollIntoView({
		block: 'nearest',
		inline: 'nearest',
	});
	e.preventDefault();
});

// TV remotes: a text field reached with the arrows stays read-only (Android pops its keyboard on
// focus); OK or a click opens it
if (!touch && /Android|Player1TV/.test(navigator.userAgent)) {
	const isInput = (el: EventTarget | null): el is HTMLInputElement => el instanceof HTMLInputElement;
	const type = (el: HTMLInputElement) => {
		el.readOnly = false;
		el.blur();
		el.dataset.typing = '1';
		el.focus();
	};
	addEventListener('focusin', e => {
		if (isInput(e.target) && !e.target.dataset.typing) e.target.readOnly = true;
	});
	addEventListener('focusout', e => {
		if (isInput(e.target)) delete e.target.dataset.typing;
	});
	addEventListener('keydown', e => {
		const el = document.activeElement;
		if (e.key !== 'Enter' || !isInput(el) || !el.readOnly) return;
		e.preventDefault();
		e.stopImmediatePropagation();
		type(el);
	}, true);
	addEventListener('click', e => {
		if (isInput(e.target) && e.target.readOnly) type(e.target);
	}, true);
}
