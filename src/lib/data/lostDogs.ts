/**
 * A lost-dog search (/lost). Positions are on the Cache County road grid
 * ("2175 S 2000 W" → w 2000, s 2175) because that is how every ping and sighting gets
 * reported. The data is hardcoded in pretzelSearch.ts; the page is staff-only.
 */
export interface LostDogEvent {
	/** Display date, e.g. "10/31". */
	d: string;
	/** Display time, e.g. "~12:01 pm". */
	t: string;
	/** Hour of day in Mountain time, for the activity chart. Leave out when unknown. */
	h?: number;
	/** seen = a person actually saw him. clue = heat source, poop, a searcher's spot, etc. */
	k: 'ping' | 'seen' | 'clue' | 'land';
	w: number;
	s: number;
	who: string;
	q: string;
	/** exact | approx | ok | nogo | area | context */
	c: string;
	/** Slack permalink. */
	link?: string;
	channel?: string;
	addr?: string;
	/** He had moved since the previous report. */
	mv?: boolean;
	/** Draw a "heading north" arrow. */
	arrow?: boolean;
	/** A searcher's position, not a sighting. */
	search?: boolean;
	/** Listed in the log but not drawn on the map. */
	hide?: boolean;
	/** [w1, s1, w2, s2] rectangle on the grid. */
	zone?: [number, number, number, number];
	/** zone style: 'area' (first search area), 'field' (seen in this field), or 'dawn' (where to wait at first light). */
	zoneKind?: 'area' | 'field' | 'dawn';
}

export interface LostDog {
	id: string;
	name: string;
	status: 'missing' | 'found';
	home?: { w: number; s: number; label: string; address: string };
	hotspot?: { w: number; s: number; rw: number; rs: number };
	summary?: { lastKnown?: string; hotspot?: string; mostActive?: string; dawn?: string };
	/** Busiest window for the hour chart, [from, to] in hours. */
	activeWindow?: [number, number];
	/** Hour window with the most AirTag pings (he's near houses and the street), [from, to]. */
	pingWindow?: [number, number];
	events: LostDogEvent[];
	/** Undated saved pins from someone's map app, [w, s]. */
	pins?: [number, number][];
	updatedAt?: string;
}
