/** class names joined, the false ones left out */
export const cx = (...names: (string | false | null | undefined)[]) =>
	names.filter(Boolean).join(' ');
