import {
	type ReactNode,
	useCallback,
	useEffect,
	useRef,
	useState,
} from 'react';

import type { ProfileSummary } from '@player1/shared/api';

import {
	ApiError,
	get,
} from '../lib/api.ts';
import { activate } from '../lib/i18n.ts';
import {
	keep,
	load,
} from '../lib/store.ts';
import {
	backFromControls,
	backFromNext,
	play,
	stop,
} from '../player/engine.ts';
import { Player } from '../player/Player.tsx';
import { Browse } from '../screens/Browse.tsx';
import { Categories } from '../screens/Categories.tsx';
import { Discover } from '../screens/Discover.tsx';
import { Home } from '../screens/Home.tsx';
import { PairScreen } from '../screens/Pair.tsx';
import { Rewatch } from '../screens/Rewatch.tsx';
import { Search } from '../screens/Search.tsx';
import { SettingsPage } from '../screens/Settings.tsx';
import {
	SetupLocked,
	SetupWizard,
} from '../screens/Setup.tsx';
import { Title } from '../screens/Title.tsx';
import { Welcome } from '../screens/Welcome.tsx';
import { WhoScreen } from '../screens/Who.tsx';
import type { PickProfile } from '../sheets/profiles.tsx';
import { cx } from '../ui/cx.ts';
import { usePending } from '../ui/load.ts';
import {
	closeSheet,
	sheetBack,
	SheetHost,
} from '../ui/sheet.tsx';
import { Toast } from '../ui/toast.tsx';
import {
	PagePreview,
	preview,
} from '../ui/Trailer.tsx';
import s from './App.module.scss';
import { Curtain } from './Curtain.tsx';
import { connect } from './events.ts';
import { Header } from './Header.tsx';
import {
	type Route,
	useRoute,
} from './router.ts';
import {
	app,
	myProfile,
	setApp,
	useApp,
} from './state.ts';

// Start: setup on a fresh server, pairing on a new device, who's watching on a shared one, then
// the pages. The player sits over whatever page was open, so Back returns to it at once.

type Phase =
	| { is: 'loading' }
	| { is: 'setup' | 'locked' | 'pair' | 'who' | 'ready' }
	| { is: 'error'; msg: string };

async function boot(): Promise<Phase> {
	try {
		const s = await get('state');
		setApp(s);
		if (!s.profiles.some(p => p.id === load('profile'))) {
			if (s.profiles.length > 1) return { is: 'who' };
			keep('profile', s.profile);
		}
		const lang = myProfile()?.lang;
		keep('lang', await activate(lang ?? load('lang')));
		connect();
		return { is: 'ready' };
	} catch (err) {
		const status = err instanceof ApiError ? err.status : 0;
		if (status === 503) return { is: (await get('setup')).ok ? 'setup' : 'locked' };
		if (status === 401) return { is: 'pair' };
		return {
			is: 'error',
			msg: (err as Error).message,
		};
	}
}

function Page({ route }: { route: Route }) {
	switch (route.page) {
		case 'cats': return <Categories />;
		case 'rewatch': return <Rewatch />;
		case 'discover': return <Discover kind={route.kind} />;
		case 'search': return <Search q={route.q} />;
		case 'browse': return <Browse cat={route.key} />;
		case 'item': return <Title type={route.type} id={route.id} />;
		case 'settings': return <SettingsPage />;
		default: return <Home />;
	}
}

/** the pages, the player over them */
function Pages({ onPick }: { onPick: PickProfile }) {
	const { hash, route } = useRoute();
	const under = useRef<Route>({ page: 'home' });
	if (route.page !== 'play') under.current = route;
	useEffect(() => {
		closeSheet();
		preview();
		if (route.page === 'play') return play(route.req);
		stop();
		scrollTo(0, 0);
		// a new page each time the address changes, even to the same one
	}, [hash]); // eslint-disable-line react-hooks/exhaustive-deps
	return (
		<>
			<PagePreview />
			<Header route={under.current} onPick={onPick} />
			<main id="view" className={s.view}>
				<Page key={hash.startsWith('#/play') ? 'under' : hash} route={under.current} />
			</main>
		</>
	);
}

/** a profile's first visit before anything else, then the pages */
function Ready({ onPick }: { onPick: PickProfile }) {
	const { welcome } = useApp();
	if (welcome) return <main id="view" className={cx(s.view, s.bare)}><Welcome /></main>;
	return <Pages onPick={onPick} />;
}

// the TV app's Back button asks this first: true = handled here, false = go back a page
window.p1Back = () => backFromNext() || sheetBack() || backFromControls();

export function App() {
	const [phase, setPhase] = useState<Phase>({ is: 'loading' });
	// the curtain: down at the start, and over the page while another profile loads
	const [cover, setCover] = useState<{ who?: ProfileSummary } | null>({});
	const start = useCallback(() => {
		boot().then(setPhase);
	}, []);
	useEffect(start, [start]);
	const pick: PickProfile = useCallback(id => {
		keep('profile', id);
		setPhase({ is: 'loading' });
		setCover({ who: app().profiles.find(p => p.id === id) });
		// the old page stays under the curtain as it comes down
		setTimeout(start, 300);
	}, [start]);
	// lifts once the first page has fetched what it shows (a moment's grace: a page asks on mount)
	const pending = usePending();
	const [settled, setSettled] = useState<Phase | null>(null);
	useEffect(() => {
		if (phase.is === 'loading' || pending) return;
		const t = setTimeout(() => setSettled(phase), 150);
		return () => clearTimeout(t);
	}, [phase, pending]);
	// what shows: the page there was while the next one loads under the curtain
	const last = useRef(phase);
	if (phase.is !== 'loading') last.current = phase;
	const at = last.current;
	let screen: ReactNode = null;
	const view = (node: ReactNode, bare = false) => (
		<main id="view" className={cx(s.view, bare && s.bare)}>{node}</main>
	);
	if (at.is === 'setup') screen = view(<SetupWizard />, true);
	else if (at.is === 'locked') screen = view(<SetupLocked />);
	else if (at.is === 'pair') screen = view(<PairScreen />);
	else if (at.is === 'who') screen = view(<WhoScreen onPick={pick} />);
	else if (at.is === 'error') screen = view(<p className={s.message}>{at.msg}</p>);
	// a new profile's pages start afresh
	else if (at.is === 'ready') screen = <Ready key={app().profile} onPick={pick} />;
	return (
		<>
			{screen}
			{cover && (
				<Curtain
					who={cover.who}
					done={settled === phase}
					gate={phase.is === 'ready'}
					onGone={() => setCover(null)}
				/>
			)}
			<Player />
			<SheetHost />
			<Toast />
		</>
	);
}
