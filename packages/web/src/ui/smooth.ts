import {
	type RefObject,
	useLayoutEffect,
	useRef,
} from 'react';

/**
 * A box whose content changes size glides to its new height instead of snapping, and whatever is
 * laid out around it (a centered card, the buttons under it) follows at the same pace.
 *
 * After each render: where the box visibly is (mid-glide included), where its content now wants it
 * to be, and an animation from one to the other.
 */
export function useSmoothHeight(ref: RefObject<HTMLElement | null>, ms = 340) {
	const last = useRef<number | null>(null);
	const running = useRef<Animation | null>(null);
	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) return;
		const from = running.current ? el.getBoundingClientRect().height : last.current;
		running.current?.cancel();
		running.current = null;
		const to = el.offsetHeight;
		last.current = to;
		if (from == null || Math.abs(from - to) < 1) return;
		// clipped while it moves: the content is already the new one
		const glide = el.animate([{
			height: `${from}px`,
			overflow: 'hidden',
		}, {
			height: `${to}px`,
			overflow: 'hidden',
		}], {
			duration: ms,
			easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
		});
		running.current = glide;
		const done = () => {
			if (running.current === glide) running.current = null;
		};
		glide.onfinish = done;
		glide.oncancel = done;
	});
}
