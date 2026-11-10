<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import type { LostDog, LostDogEvent } from '$lib/data/lostDogs';

	export let dog: LostDog;

	// Grid → SVG. W grows west (left), S grows south (down). 400 grid units ≈ 0.5 mi.
	// The base layer is OpenStreetMap tiles calibrated to the grid around Pretzel's search
	// (west of Nibley / north of Wellsville). A search somewhere else would need its own calibration.
	// Tile calibration: 2000 W / 2200 S sit at z17 global pixel GX, GY; K z17 pixels per grid unit.
	const GX = 24797 * 256 + 1068, GY = 48804 * 256 + 596, K = 2.25;
	// One grid unit is about 2 m here (z17 is ~0.89 m per pixel at this latitude).
	const M_PER_UNIT = (156543.03 * Math.cos((41.69 * Math.PI) / 180) / 2 ** 17) * K;
	const X = (w: number) => 2860 - w;
	const Y = (s: number) => s - 1640;
	const NS = 'http://www.w3.org/2000/svg';

	let mapEl: SVGSVGElement;
	let hoursEl: SVGSVGElement;
	let filter: 'all' | 'ping' | 'seen' | 'clue' | 'land' = 'all';
	let selected: number | null = null;
	let mounted = false;
	let marks: (SVGGElement | undefined)[] = [];
	let numbers: (number | undefined)[] = [];
	// Wide screens get a landscape view of the whole search; phones get a taller, closer view
	// centered on the foster home so the markers are big enough to tap.
	let narrow = false;
	let asp = 1000 / 1300; // view height / width
	let V0 = [20, 60, 1300, 1000];
	let view = [...V0];

	const col: Record<string, string> = { ping: 'var(--ld-ping)', seen: 'var(--ld-seen)', clue: 'var(--ld-clue)', land: 'var(--ld-ok)' };
	const confLabel: Record<string, string> = {
		exact: 'exact address',
		approx: 'approx',
		ok: 'ok to search',
		nogo: 'stay off',
		area: 'area',
		context: 'context'
	};
	// The most recent ping (by date, then hour) gets its own color so it's easy to find.
	const when = (e: LostDogEvent) => {
		const [m, d] = (e.d ?? '').split('/').map(Number);
		return (m || 0) * 10000 + (d || 0) * 100 + (e.h ?? 0);
	};
	$: latest = dog.events.filter((e) => e.k === 'ping' && !e.hide && e.h != null).reduce<LostDogEvent | null>((a, e) => (!a || when(e) >= when(a) ? e : a), null);
	const colorOf = (e: LostDogEvent) => (e === latest ? 'var(--ld-latest)' : e.c === 'nogo' ? 'var(--ld-nogo)' : e.hide ? 'var(--ld-muted)' : col[e.k]);

	function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, parent: Element) {
		const e = document.createElementNS(NS, tag);
		for (const k in attrs) e.setAttribute(k, String(attrs[k]));
		parent.appendChild(e);
		return e;
	}

	// Markers are drawn in map units. Scale them so they stay the same size on screen at any
	// zoom (zooming in spreads them apart instead of growing them), and bigger on phones.
	const scaled: [SVGElement, number, number, number][] = [];
	const mkT = (x: number, y: number, k: number) => {
		const f = k * (narrow ? 1.7 : 1) * (view[2] / V0[2]);
		return `translate(${x} ${y}) scale(${f}) translate(${-x} ${-y})`;
	};
	const big = (x: number, y: number, k = 1) => mkT(x, y, k);
	function track<T extends SVGElement>(g: T, x: number, y: number, k = 1): T {
		scaled.push([g, x, y, k]);
		return g;
	}
	function rescale() {
		for (const [g, x, y, k] of scaled) g.setAttribute('transform', mkT(x, y, k));
	}

	function drawMap() {
		if (!mapEl) return;
		mapEl.replaceChildren();
		marks = [];
		numbers = [];
		const g0 = el('g', {}, mapEl);
		el('rect', { x: -2000, y: -2000, width: 5000, height: 5000, fill: 'var(--ld-land)' }, g0);
		// Base layer: OpenStreetMap tiles placed on the county grid. Calibrated against the labeled
		// roads in the tiles (2000 W / 2200 S at z17 global pixel GX, GY; K z17 pixels per grid unit).
		const Z = 16, T = 512 / K;
		const tiles = el('g', { class: 'tiles' }, g0);
		const tx0 = Math.floor((GX + (-400 - 860) * K) / 512), tx1 = Math.floor((GX + (1700 - 860) * K) / 512);
		const ty0 = Math.floor((GY + (-300 - 560) * K) / 512), ty1 = Math.floor((GY + (1300 - 560) * K) / 512);
		for (let tx = tx0; tx <= tx1; tx++)
			for (let ty = ty0; ty <= ty1; ty++)
				el('image', { href: `https://tile.openstreetmap.org/${Z}/${tx}/${ty}.png`, x: 860 + (tx * 512 - GX) / K, y: 560 + (ty * 512 - GY) / K, width: T + 0.5, height: T + 0.5, preserveAspectRatio: 'none' }, tiles);
		const lab = (x: number, y: number, txt: string, rot = false, extra: Record<string, string | number> = {}) => {
			const t = el('text', { x, y, 'font-size': 12, 'text-anchor': 'middle', fill: 'var(--ld-label)', stroke: 'var(--ld-halo)', 'stroke-width': 3, 'paint-order': 'stroke', 'font-weight': 500, ...(rot ? { transform: `rotate(-90 ${x} ${y})` } : {}), ...extra }, g0);
			t.textContent = txt;
			return t;
		};
		for (const w of [1600, 2000, 2400, 2800]) lab(X(w) - 10, Y(2080), `S ${w} W`, true, { 'font-size': 15, 'font-weight': 700 });
		for (const s of [1800, 2200, 2600]) lab(X(2300), Y(s) - 8, `W ${s} S`, false, { 'font-size': 15, 'font-weight': 700 });
		if (dog.hotspot) {
			const h = dog.hotspot;
			el('ellipse', { cx: X(h.w), cy: Y(h.s), rx: h.rw, ry: h.rs, fill: 'var(--ld-hot)', stroke: 'var(--ld-ping)', 'stroke-dasharray': '6 5', 'stroke-width': 1.4 }, g0);
			lab(X(h.w), Y(h.s) - h.rs - 8, 'HOTSPOT', false, { fill: 'var(--ld-ping)', 'font-weight': 700, 'font-size': 11 });
		}
		// Zone tags: [anchor x, y, tag x, y, lines, color]. Drawn after the zones, at a constant screen size.
		const tags: [number, number, number, number, string[], string, number][] = [];
		// Permission areas go underneath everything else, so a no-go inside one still shows red.
		const zoned = dog.events.filter((e) => e.zone).sort((a, b) => Number(b.zoneKind === 'ok') - Number(a.zoneKind === 'ok'));
		for (const e of zoned) {
			const [w1, s1, w2, s2] = e.zone!;
			const ei = dog.events.indexOf(e);
			const c = e.c === 'nogo' ? 'var(--ld-nogo)' : e.zoneKind === 'dawn' || e.zoneKind === 'ok' ? 'var(--ld-ok)' : 'var(--ld-seen)';
			if (e.zoneKind === 'ok') {
				const okStyle = { fill: c, 'fill-opacity': 0.08, stroke: c, 'stroke-width': 2.5, 'stroke-linejoin': 'round' };
				const shape = e.zonePoly
					? el('polygon', { points: e.zonePoly.map(([w, s]) => `${X(w)},${Y(s)}`).join(' '), ...okStyle }, g0)
					: el('rect', { x: X(w2), y: Y(s1), width: X(w1) - X(w2), height: Y(s2) - Y(s1), rx: 6, ...okStyle }, g0);
				tapZone(shape, ei);
				const [tw, ts] = e.zoneTagAt ?? [w2 + 120, s1];
				tags.push([X(w2), Y(s1) + (Y(s2) - Y(s1)) * 0.15, X(tw), Y(ts), ['OK TO SEARCH', e.zoneLabel ?? ''], c, ei]);
				continue;
			}
			const box = el('rect', { x: X(w2), y: Y(s1), width: X(w1) - X(w2), height: Y(s2) - Y(s1), rx: 4, fill: c, 'fill-opacity': 0.1, stroke: c, 'stroke-dasharray': '5 4', 'stroke-width': 1.4 }, g0);
			if (e.zoneKind === 'dawn') tapZone(box, ei);
			// The dawn box sits in a crowd of markers, so it gets a tag out in open ground with a pointer line.
			if (e.zoneKind === 'dawn') {
				const [tw, ts] = e.zoneTagAt ?? [w2 + 150, s2 + 60];
				tags.push([X(w2), Y(s1) + (Y(s2) - Y(s1)) / 2, X(tw), Y(ts), ['DAWN SPOT'], c, ei]);
			} else lab(X(w2) + (X(w1) - X(w2)) / 2, Y(s2) + 16, e.c === 'nogo' ? 'no-go (approx)' : e.zoneKind === 'area' ? 'first search area' : 'seen running in this field', false, { fill: c, 'font-size': 11, 'font-weight': 700 });
		}
		scaled.length = 0;
		// Tags stay hidden until their area (or its pin / list row) is tapped.
		zoneTags.length = 0;
		for (const [ax, ay, tx, ty, lines, c, ei] of tags) {
			const zt = el('g', { 'pointer-events': 'none' }, g0);
			el('line', { x1: ax, y1: ay, x2: tx, y2: ty, stroke: c, 'stroke-width': 2, 'vector-effect': 'non-scaling-stroke' }, zt);
			el('circle', { cx: ax, cy: ay, r: 3, fill: c }, track(el('g', { transform: big(ax, ay) }, zt), ax, ay));
			const g = track(el('g', { transform: big(tx, ty) }, zt), tx, ty);
			const r = el('rect', { rx: 5, fill: c, stroke: 'var(--ld-halo)', 'stroke-width': 1.5 }, g);
			const txt = el('text', { x: tx, y: ty - (lines.length - 1) * 6.5 + 4, 'text-anchor': 'middle', fill: '#fff', 'font-size': 11 }, g);
			lines.filter(Boolean).forEach((l, i) => {
				const sp = el('tspan', { x: tx, dy: i ? 13 : 0, 'font-weight': i ? 500 : 800, 'font-size': i ? 10 : 11.5 }, txt);
				sp.textContent = l;
			});
			const b = txt.getBBox();
			for (const [k, v] of Object.entries({ x: b.x - 6, y: b.y - 3, width: b.width + 12, height: b.height + 6 })) r.setAttribute(k, String(v));
			zoneTags.push([zt, ei]);
		}
		if (dog.home) {
			const x = X(dog.home.w), y = Y(dog.home.s);
			const g = track(el('g', { transform: big(x, y, 0.6) }, g0), x, y, 0.6);
			el('circle', { cx: x, cy: y, r: 16, fill: 'var(--ld-fg)', stroke: 'var(--ld-halo)', 'stroke-width': 3 }, g);
			el('path', { d: `M${x - 8},${y + 1} L${x},${y - 7} L${x + 8},${y + 1} M${x - 5},${y - 1} L${x - 5},${y + 7} L${x + 5},${y + 7} L${x + 5},${y - 1}`, fill: 'none', stroke: 'var(--ld-panel)', 'stroke-width': 2, 'stroke-linejoin': 'round' }, g);
			const hl = lab(x, y + 40, dog.home.label, false, { fill: 'var(--ld-fg)', 'font-weight': 700 });
			if (hl) { g.appendChild(hl); }
		}
		for (const [w, s] of dog.pins ?? []) {
			const g = track(el('g', { class: 'mk', 'data-k': 'pin', transform: big(X(w), Y(s)) }, g0), X(w), Y(s));
			el('path', { class: 'pinbody', d: `M${X(w)},${Y(s)} c-2,-6 -8,-10 -8,-16 a8,8 0 1,1 16,0 c0,6 -6,10 -8,16 z`, fill: 'var(--ld-pin)', stroke: 'var(--ld-halo)', 'stroke-width': 1.5 }, g);
		}
		let n = 0;
		dog.events.forEach((e, i) => {
			if (e.hide) return;
			numbers[i] = ++n;
			const c = colorOf(e);
			const x = X(e.w), y = Y(e.s);
			const g = track(el('g', { class: 'mk', 'data-k': e.k, transform: big(x, y) }, g0), x, y);
			if (e.arrow) el('path', { d: `M${x + 20},${y - 4} l0,-70 m-7,10 l7,-10 l7,10`, stroke: 'var(--ld-seen)', 'stroke-width': 3, fill: 'none', 'stroke-linecap': 'round' }, g);
			if (e.search) el('circle', { class: 'pinbody', cx: x, cy: y, r: 9, fill: 'var(--ld-panel)', stroke: c, 'stroke-width': 2, 'stroke-dasharray': '3 2' }, g);
			else el('path', { class: 'pinbody', d: `M${x},${y} c-3,-9 -13,-14 -13,-25 a13,13 0 1,1 26,0 c0,11 -10,16 -13,25 z`, fill: c, stroke: 'rgba(0,0,0,.25)', 'stroke-width': 1 }, g);
			if (e === latest) el('circle', { cx: x, cy: y - 21, r: 19, fill: 'none', stroke: 'var(--ld-latest)', 'stroke-width': 3 }, g);
			const t = el('text', { x, y: e.search ? y + 4 : y - 21, 'text-anchor': 'middle', 'font-size': 11, 'font-weight': 700, fill: e.search ? c : e === latest ? '#202124' : '#fff', 'pointer-events': 'none' }, g);
			t.textContent = String(n);
			g.addEventListener('click', () => { if (!dragged) pick(i); });
			marks[i] = g;
		});
		// keep the latest ping on top of anything near it
		const li = latest ? dog.events.indexOf(latest) : -1;
		if (li >= 0 && marks[li]) g0.appendChild(marks[li]);
		applyFilter();
		applySelection();
		drawMe();
	}

	function drawHours() {
		if (!hoursEl) return;
		hoursEl.replaceChildren();
		const HW = narrow ? 520 : 900;
		hoursEl.setAttribute('viewBox', `0 0 ${HW} 165`);
		const L = narrow ? 24 : 40, R = HW - 20, base = 110, x = (h: number) => L + ((R - L) * h) / 24;
		const timed = dog.events.filter((e) => e.h != null && !e.hide && (e.k !== 'clue' || !e.search)).sort((a, b) => (a.h ?? 0) - (b.h ?? 0));
		// Shade the hours that have no reports at all.
		const has = new Set(timed.map((e) => Math.floor(e.h ?? 0)));
		for (let h = 0; h < 24; h++)
			if (!has.has(h)) el('rect', { x: x(h), y: 20, width: x(h + 1) - x(h), height: base - 20, fill: 'var(--ld-line)', 'fill-opacity': 0.35 }, hoursEl);
		if (dog.activeWindow) {
			const [a, b] = dog.activeWindow;
			el('rect', { x: x(a), y: 14, width: x(b) - x(a), height: base - 14, rx: 4, fill: 'none', stroke: 'var(--ld-ping)', 'stroke-width': 1, 'stroke-dasharray': '4 3' }, hoursEl);
			const t = el('text', { x: (x(a) + x(b)) / 2, y: 12, 'text-anchor': 'middle', 'font-size': 14, 'font-weight': 700, fill: 'var(--ld-ping)' }, hoursEl);
			t.textContent = narrow ? 'MOVING' : 'MOST MOVEMENT';
		}
		if (dog.pingWindow) {
			const [a, b] = dog.pingWindow;
			el('rect', { x: x(a), y: 14, width: x(b) - x(a), height: base - 14, rx: 4, fill: 'var(--ld-hot)', stroke: 'var(--ld-ping)', 'stroke-width': 1.5 }, hoursEl);
			const t = el('text', { x: (x(a) + x(b)) / 2, y: 12, 'text-anchor': 'middle', 'font-size': 14, 'font-weight': 700, fill: 'var(--ld-ping)' }, hoursEl);
			t.textContent = narrow ? 'PINGS' : 'MOST PINGS';
		}
		el('line', { x1: L, y1: base, x2: R, y2: base, stroke: 'var(--ld-muted)', 'stroke-width': 1 }, hoursEl);
		for (let h = 0; h <= 24; h += 3) {
			el('line', { x1: x(h), y1: base, x2: x(h), y2: base + 5, stroke: 'var(--ld-muted)' }, hoursEl);
			const t = el('text', { x: x(h), y: base + 24, 'text-anchor': 'middle', 'font-size': 16, fill: 'var(--ld-muted)' }, hoursEl);
			t.textContent = h === 0 || h === 24 ? '12am' : h === 12 ? '12pm' : h < 12 ? `${h}am` : `${h - 12}pm`;
		}
		const stack: Record<number, number> = {};
		for (const e of timed) {
			const b = Math.floor((e.h ?? 0) * 2) / 2;
			const k = (stack[b] = (stack[b] ?? 0) + 1);
			const c = e === latest ? 'var(--ld-latest)' : col[e.k] ?? 'var(--ld-ping)';
			const m = el('circle', { cx: x(e.h ?? 0), cy: base - 10 - (k - 1) * 20, r: 9, fill: e.mv ? 'var(--ld-panel)' : c, stroke: c, 'stroke-width': 2.2 }, hoursEl);
			const tt = el('title', {}, m);
			tt.textContent = `${e.d} ${e.t} · ${e.who}`;
		}
		const lg = el('text', { x: R, y: base + 46, 'text-anchor': 'end', 'font-size': 16, fill: 'var(--ld-muted)' }, hoursEl);
		lg.textContent = narrow ? '○ had moved · red ping · blue seen · orange clue' : '● same spot as last report   ○ had moved   red = ping · blue = seen · orange = clue';
	}

	function setFilter(f: string) {
		filter = f as typeof filter;
	}
	function applyFilter() {
		mapEl?.querySelectorAll<SVGGElement>('.mk').forEach((m) => {
			m.classList.toggle('dim', !(filter === 'all' || m.dataset.k === filter));
		});
	}
	// Zone tags ([tag group, event index]) show only while that event is selected.
	const zoneTags: [SVGGElement, number][] = [];
	function tapZone(shape: SVGElement, i: number) {
		shape.style.cursor = 'pointer';
		shape.addEventListener('click', () => { if (!dragged) pick(i); });
	}
	function applySelection() {
		marks.forEach((m, j) => m?.classList.toggle('sel', j === selected));
		for (const [g, i] of zoneTags) g.style.display = i === selected ? '' : 'none';
	}
	function pick(i: number) {
		selected = selected === i ? null : i;
		applySelection();
		if (selected !== null && window.innerWidth <= 880 && marks[selected]) mapEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
	}

	// Pan and zoom by moving the viewBox.
	let dragged = false;
	let p0: { x: number; y: number; v: number[] } | null = null;
	const setView = () => { mapEl?.setAttribute('viewBox', view.join(' ')); rescale(); drawMe(); };

	// "Show me": the phone's GPS position as a blue dot with its accuracy circle.
	let me: { x: number; y: number; acc: number } | null = null;
	let watchId: number | null = null;
	let gpsMsg = '';
	function toMap(lat: number, lon: number) {
		const n = 256 * 2 ** 17, r = (lat * Math.PI) / 180;
		const px = ((lon + 180) / 360) * n, py = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n;
		return { x: 860 + (px - GX) / K, y: 560 + (py - GY) / K };
	}
	function drawMe() {
		mapEl?.querySelector('.me')?.remove();
		if (!mapEl || !me) return;
		const f = (narrow ? 1.7 : 1) * (view[2] / V0[2]);
		const g = el('g', { class: 'me', 'pointer-events': 'none' }, mapEl);
		el('circle', { cx: me.x, cy: me.y, r: Math.max(me.acc / M_PER_UNIT, 8 * f), fill: '#1a73e8', 'fill-opacity': 0.15, stroke: '#1a73e8', 'stroke-opacity': 0.4, 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke' }, g);
		el('circle', { cx: me.x, cy: me.y, r: 7 * f, fill: '#1a73e8', stroke: '#fff', 'stroke-width': 2.5, 'vector-effect': 'non-scaling-stroke' }, g);
	}
	const ft = (units: number) => Math.round((units * M_PER_UNIT * 3.281) / 10) * 10;
	$: meNote = me && latest ? `You're ~${ft(Math.hypot(me.x - X(latest.w), me.y - Y(latest.s))).toLocaleString()} ft from the latest ping (gold). GPS ±${ft(me.acc / M_PER_UNIT)} ft.` : '';
	function toggleGps() {
		if (watchId !== null) {
			navigator.geolocation.clearWatch(watchId);
			watchId = null; me = null; gpsMsg = ''; drawMe();
			return;
		}
		if (!('geolocation' in navigator)) { gpsMsg = "This browser can't share location."; return; }
		gpsMsg = 'Finding you…';
		let first = true;
		watchId = navigator.geolocation.watchPosition(
			(p) => {
				me = { ...toMap(p.coords.latitude, p.coords.longitude), acc: p.coords.accuracy };
				gpsMsg = '';
				if (first) {
					first = false;
					// Center on you if you're inside the map area; otherwise leave the view alone.
					if (me.x > -400 && me.x < 1700 && me.y > -300 && me.y < 1300) { view = [me.x - view[2] / 2, me.y - view[3] / 2, view[2], view[3]]; setView(); }
					else gpsMsg = "You're outside this map's area.";
				}
				drawMe();
			},
			(err) => { gpsMsg = err.code === 1 ? 'Location is blocked. Allow location for this site in your browser settings.' : "Couldn't get your location."; if (watchId !== null) navigator.geolocation.clearWatch(watchId); watchId = null; },
			{ enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
		);
	}
	onDestroy(() => { if (watchId !== null && typeof navigator !== 'undefined') navigator.geolocation.clearWatch(watchId); });
	function zoom(f: number) {
		const cx = view[0] + view[2] / 2, cy = view[1] + view[3] / 2;
		const w = clampW(view[2] * f);
		view = [cx - w / 2, cy - (w * asp) / 2, w, w * asp];
		setView();
	}
	// One finger/mouse pans; two fingers pinch-zoom around their midpoint; the wheel zooms at the cursor.
	const pts = new Map<number, { x: number; y: number }>();
	let pinch0: { d: number; mx: number; my: number; v: number[] } | null = null;
	const clampW = (w: number) => Math.min(2000, Math.max(30, w));
	function toSvg(cx: number, cy: number, v: number[]) {
		const r = mapEl.getBoundingClientRect();
		return { x: v[0] + ((cx - r.left) / r.width) * v[2], y: v[1] + ((cy - r.top) / r.height) * v[3] };
	}
	function zoomAt(cx: number, cy: number, w: number, v: number[]) {
		const r = mapEl.getBoundingClientRect();
		const p = toSvg(cx, cy, v);
		const h = w * asp;
		view = [p.x - ((cx - r.left) / r.width) * w, p.y - ((cy - r.top) / r.height) * h, w, h];
		setView();
	}
	function startPinch() {
		const [a, b] = [...pts.values()];
		pinch0 = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, v: [...view] };
		p0 = null;
		dragged = true;
	}
	function down(e: PointerEvent) {
		// A primary pointer means nothing else is touching, so drop any finger whose
		// pointerup we never got (otherwise one finger acts like a pinch and zooms).
		if (e.isPrimary) { pts.clear(); pinch0 = null; }
		pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
		if (pts.size === 2) startPinch();
		else if (pts.size === 1) { p0 = { x: e.clientX, y: e.clientY, v: [...view] }; dragged = false; }
	}
	function move(e: PointerEvent) {
		if (pts.has(e.pointerId)) pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
		if (pinch0 && pts.size >= 2) {
			const [a, b] = [...pts.values()];
			const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
			const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
			// Zoom around the starting midpoint, then pan by how far the midpoint moved.
			const w = clampW(pinch0.v[2] * (pinch0.d / d));
			const anchor = toSvg(pinch0.mx, pinch0.my, pinch0.v);
			const r = mapEl.getBoundingClientRect();
			const h = w * asp;
			view = [anchor.x - ((mx - r.left) / r.width) * w, anchor.y - ((my - r.top) / r.height) * h, w, h];
			setView();
			return;
		}
		if (!p0) return;
		const k = view[2] / mapEl.getBoundingClientRect().width;
		const dx = e.clientX - p0.x, dy = e.clientY - p0.y;
		if (Math.abs(dx) + Math.abs(dy) > 4) dragged = true;
		view = [p0.v[0] - dx * k, p0.v[1] - dy * k, view[2], view[3]];
		setView();
	}
	function up(e: PointerEvent) {
		pts.delete(e.pointerId);
		if (pts.size < 2) pinch0 = null;
		if (pts.size === 1) { const [q] = [...pts.values()]; p0 = { x: q.x, y: q.y, v: [...view] }; }
		else p0 = null;
		setTimeout(() => (dragged = false), 0);
	}
	function wheel(e: WheelEvent) {
		e.preventDefault();
		zoomAt(e.clientX, e.clientY, clampW(view[2] * Math.exp(e.deltaY * 0.0015)), view);
	}

	onMount(() => {
		narrow = window.innerWidth <= 600;
		if (narrow) {
			asp = 1.25;
			V0 = [360, -80, 880, 1100];
		}
		// Widen the starting view just enough to include the latest ping.
		if (latest) {
			const m = 60, lx = X(latest.w), ly = Y(latest.s);
			let [x0, y0, w] = V0;
			const x1 = Math.max(x0 + w, lx + m);
			x0 = Math.min(x0, lx - m);
			w = x1 - x0;
			let h = Math.max(w * asp, V0[3]);
			w = h / asp;
			if (ly - m < y0) y0 = ly - m;
			if (ly + m > y0 + h) y0 = ly + m - h;
			V0 = [x0, y0, w, h];
		}
		view = [...V0];
		setView();
		mounted = true;
	});
	$: if (mounted && dog) { drawMap(); drawHours(); }
	$: if (mounted) { filter; applyFilter(); }

	$: days = dog.events.reduce<{ d: string; items: { e: LostDogEvent; i: number }[] }[]>((acc, e, i) => {
		const last = acc[acc.length - 1];
		if (last && last.d === e.d) last.items.push({ e, i });
		else acc.push({ d: e.d, items: [{ e, i }] });
		return acc;
	}, []);
	const mapsLink = (addr: string) => `https://maps.google.com/?q=${encodeURIComponent(addr.replace('~', '') + ', Wellsville, UT 84339')}`;
</script>

<div class="ld">

	<section class="act">
		<h2>When he's been found, by hour</h2>
		<p>Each mark is one ping or sighting with a known time. Hollow marks are where he had moved since the last report.</p>
		<div class="hscroll"><svg bind:this={hoursEl} viewBox="0 0 900 165" class="hours" role="img" aria-label="Pings and sightings by hour of day"></svg></div>
	</section>

	<div class="grid">
		<div class="mapbox">
			<div class="mapwrap">
			<!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
			<svg bind:this={mapEl} viewBox="20 60 1300 1000" class="map" role="img" aria-label="Map of {dog.name} sightings"
				on:pointerdown={down} on:pointermove={move} on:pointerup={up} on:pointercancel={up} on:pointerleave={up} on:wheel|nonpassive={wheel}></svg>
			<div class="zoom">
				<button type="button" aria-label="Zoom in" on:click={() => zoom(0.7)}>+</button>
				<button type="button" aria-label="Zoom out" on:click={() => zoom(1 / 0.7)}>−</button>
				<button type="button" aria-label="Reset view" on:click={() => { view = [...V0]; setView(); }}>⟲</button>
				<button type="button" aria-label="Show my location" aria-pressed={watchId !== null} class:on={watchId !== null} on:click={toggleGps}>◎</button>
			</div>
			{#if gpsMsg || meNote}<div class="gps">{gpsMsg || meNote}</div>{/if}
			</div>
			<div class="legend">
				<span><i class="dot" style="background:var(--ld-latest)"></i>latest ping</span>
				<span><i class="dot" style="background:var(--ld-ping)"></i>AirTag ping</span>
				<span><i class="dot" style="background:var(--ld-seen)"></i>seen by a person</span>
				<span><i class="dot" style="background:var(--ld-clue)"></i>clue (not a sighting)</span>
				<span><i class="dot" style="background:var(--ld-pin)"></i>saved pin (no date)</span>
				<span><i class="dot" style="background:var(--ld-nogo)"></i>stay off</span>
				<span><i class="dot" style="background:var(--ld-ok)"></i>OK to search</span>
			</div>
			{#if dog.summary}
				<div class="keyfacts">
					{#if dog.summary.lastKnown}<span><b>Last known:</b> {dog.summary.lastKnown}</span>{/if}
					{#if dog.summary.hotspot}<span><b>Hotspot:</b> {dog.summary.hotspot}</span>{/if}
					{#if dog.summary.mostActive}<span><b>Most active:</b> {dog.summary.mostActive}</span>{/if}
					{#if dog.summary.dawn}<span><b>Dawn spot:</b> {dog.summary.dawn}</span>{/if}
				</div>
			{/if}
			<div class="osm">Map © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a></div>
		</div>
		<div>
			<div class="filters" role="group" aria-label="Filter">
				{#each [['all', 'All'], ['ping', 'Pings'], ['seen', 'Seen'], ['clue', 'Clues'], ['land', 'Land / access']] as [f, label]}
					<button type="button" aria-pressed={filter === f} on:click={() => setFilter(f)}>{label}</button>
				{/each}
			</div>
			<div class="log">
				{#each days as day}
					<div class="day">{day.d}</div>
					{#each day.items as { e, i }}
						{#if filter === 'all' || filter === e.k}
							<div class="ev" class:sel={selected === i} role="button" tabindex="0"
								on:click={(ev) => { if (!(ev.target instanceof HTMLAnchorElement)) pick(i); }}
								on:keydown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); pick(i); } }}>
								<span class="n" style="background:{colorOf(e)}{e === latest ? ";color:#202124" : ""}">{numbers[i] ?? '·'}</span>
								<div class="body">
									<span class="t">{e.t}</span> <span class="w">{e.who}</span>{#if e.addr} · {e.addr}{/if}<span class="conf">{confLabel[e.c] ?? e.c}</span>
									<q>{e.q}</q>
									<span class="meta">
										{#if e.channel}{e.channel} · {/if}
										{#if e.link}<a href={e.link} target="_blank" rel="noopener">open in Slack</a>{/if}
										{#if e.addr} · <a href={mapsLink(e.addr)} target="_blank" rel="noopener">Google Maps</a>{/if}
									</span>
								</div>
							</div>
						{/if}
					{/each}
				{/each}
			</div>
		</div>
	</div>
</div>

<style>
	.ld {
		--ld-panel:#ffffff; --ld-fg:#202124; --ld-muted:#5f6368; --ld-line:#dadce0;
		--ld-land:#f5f3ed; --ld-farm:#e6efd9; --ld-road:#ffffff; --ld-casing:#d4d6d9; --ld-major:#fde293; --ld-majorcase:#f2c94c;
		--ld-water:#aadaff; --ld-creek:#73b3f2; --ld-label:#5f6368; --ld-halo:#ffffff;
		--ld-ping:#ea4335; --ld-latest:#f9ab00; --ld-seen:#4285f4; --ld-clue:#e37400; --ld-pin:#a142f4; --ld-nogo:#d93025; --ld-ok:#188038; --ld-hot:rgba(234,67,53,.12);
		color: var(--ld-fg);
	}
	@media (prefers-color-scheme: dark) {
		.ld {
			--ld-panel:#202124; --ld-fg:#e8eaed; --ld-muted:#9aa0a6; --ld-line:#3c4043;
			--ld-land:#242f3e; --ld-farm:#263c3f; --ld-road:#38414e; --ld-casing:#212a37; --ld-major:#746855; --ld-majorcase:#1f2835;
			--ld-water:#17263c; --ld-creek:#3a6ea5; --ld-label:#9ca5b3; --ld-halo:#17263c;
			--ld-ping:#f28b82; --ld-latest:#fdd663; --ld-seen:#8ab4f8; --ld-clue:#fcad70; --ld-pin:#c58af9; --ld-nogo:#f28b82; --ld-ok:#81c995; --ld-hot:rgba(242,139,130,.14);
		}
	}
	.act { margin-bottom:16px; }
	.act h2 { font-size:1rem; font-weight:600; margin:0 0 2px; }
	.act p { margin:0 0 6px; color:var(--ld-muted); font-size:.9rem; max-width:80ch; }
	.hscroll { overflow-x:auto; }
	.hours { width:100%; height:auto; display:block; }
	.grid { display:grid; grid-template-columns:minmax(0,1.45fr) minmax(0,1fr); gap:16px; align-items:start; }
	@media (max-width:880px) { .grid { grid-template-columns:1fr; } }
	.mapbox { position:relative; background:var(--ld-panel); border:1px solid var(--ld-line); border-radius:8px; overflow:hidden; }
	.map { width:100%; height:auto; display:block; touch-action:none; cursor:grab; background:var(--ld-land); }
	.mapwrap { position:relative; }
	.zoom { position:absolute; right:10px; bottom:10px; display:flex; flex-direction:column; background:var(--ld-panel); border-radius:6px; box-shadow:0 1px 4px rgba(0,0,0,.3); overflow:hidden; }
	.zoom button { width:36px; height:36px; border:0; background:var(--ld-panel); color:var(--ld-muted); font-size:20px; cursor:pointer; }
	.zoom button + button { border-top:1px solid var(--ld-line); }
	.zoom button.on { color:#1a73e8; }
	.gps { position:absolute; left:10px; bottom:10px; right:56px; background:var(--ld-panel); color:var(--ld-fg); font-size:.8rem; padding:6px 9px; border-radius:6px; box-shadow:0 1px 4px rgba(0,0,0,.3); }
	.legend { display:flex; flex-wrap:wrap; gap:6px 14px; font-size:.8rem; color:var(--ld-muted); padding:8px 12px; border-top:1px solid var(--ld-line); }
	.legend span { display:inline-flex; align-items:center; gap:6px; }
	.dot { width:10px; height:10px; border-radius:50%; display:inline-block; }
	.filters { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:10px; }
	.filters button { font-size:.82rem; font-weight:500; border:1px solid var(--ld-line); background:var(--ld-panel); color:var(--ld-fg); border-radius:999px; padding:5px 12px; cursor:pointer; }
	.filters button[aria-pressed='true'] { background:var(--ld-seen); color:#fff; border-color:var(--ld-seen); }
	.log { display:flex; flex-direction:column; gap:6px; }
	.day { font-weight:700; font-size:.78rem; letter-spacing:.08em; text-transform:uppercase; color:var(--ld-muted); margin:10px 0 2px; }
	.ev { display:grid; grid-template-columns:auto 1fr; gap:4px 10px; background:var(--ld-panel); border:1px solid var(--ld-line); border-radius:8px; padding:8px 10px; cursor:pointer; min-width:0; }
	.ev.sel { border-color:var(--ld-seen); box-shadow:0 0 0 1px var(--ld-seen); }
	.ev:focus-visible { outline:2px solid var(--ld-seen); outline-offset:2px; }
	.body { min-width:0; }
	.n { font-size:.78rem; font-weight:600; width:26px; height:26px; border-radius:50%; display:grid; place-items:center; color:#fff; }
	.t { font-size:.8rem; color:var(--ld-muted); font-variant-numeric:tabular-nums; }
	.w { font-weight:600; }
	q { display:block; color:var(--ld-muted); font-size:.9rem; }
	.meta { font-size:.78rem; color:var(--ld-muted); }
	.meta a { color:var(--ld-seen); }
	.conf { font-size:.68rem; padding:1px 6px; border-radius:4px; border:1px solid var(--ld-line); margin-left:6px; white-space:nowrap; color:var(--ld-muted); }
	.map :global(.mk) { cursor:pointer; }
	@media (prefers-color-scheme: dark) { .map :global(.tiles) { filter:invert(.92) hue-rotate(180deg) brightness(.95) contrast(.9); } }
	.keyfacts { display:flex; flex-direction:column; gap:2px; font-size:.8rem; color:var(--ld-fg); padding:0 12px 8px; }
	.keyfacts b { font-weight:600; }
	.osm { font-size:.7rem; color:var(--ld-muted); padding:0 12px 8px; }
	.osm a { color:inherit; }
	.map :global(.mk.dim) { opacity:.15; }
	.map :global(.mk.sel .pinbody) { stroke:var(--ld-fg); stroke-width:2.5; }
	.map :global(text) { font-family:inherit; }
</style>
