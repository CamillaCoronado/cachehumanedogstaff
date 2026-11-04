<script lang="ts">
	import { onMount } from 'svelte';
	import type { LostDog, LostDogEvent } from '$lib/data/lostDogs';

	export let dog: LostDog;

	// Grid → SVG. W grows west (left), S grows south (down). 400 grid units ≈ 0.5 mi.
	// The base layer (roads, Spring Creek, the pond, fields) is drawn for the fields west of
	// Wellsville between 1700–2600 S and 1900–2860 W, which is where Pretzel's search is.
	// A search somewhere else would need its own base layer.
	const X = (w: number) => 2860 - w;
	const Y = (s: number) => s - 1640;
	const NS = 'http://www.w3.org/2000/svg';

	let mapEl: SVGSVGElement;
	let hoursEl: SVGSVGElement;
	let filter: 'all' | 'ping' | 'seen' | 'land' = 'all';
	let selected: number | null = null;
	let mounted = false;
	let marks: (SVGGElement | undefined)[] = [];
	let numbers: (number | undefined)[] = [];
	let view = [0, 0, 960, 1000];

	const col: Record<string, string> = { ping: 'var(--ld-ping)', seen: 'var(--ld-seen)', land: 'var(--ld-ok)' };
	const confLabel: Record<string, string> = {
		exact: 'exact address',
		approx: 'approx',
		ok: 'ok to search',
		nogo: 'stay off',
		area: 'area',
		context: 'context'
	};
	const colorOf = (e: LostDogEvent) => (e.c === 'nogo' ? 'var(--ld-nogo)' : e.hide ? 'var(--ld-muted)' : col[e.k]);

	function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, parent: Element) {
		const e = document.createElementNS(NS, tag);
		for (const k in attrs) e.setAttribute(k, String(attrs[k]));
		parent.appendChild(e);
		return e;
	}

	function drawMap() {
		if (!mapEl) return;
		mapEl.replaceChildren();
		marks = [];
		numbers = [];
		const g0 = el('g', {}, mapEl);
		el('rect', { x: -2000, y: -2000, width: 5000, height: 5000, fill: 'var(--ld-land)' }, g0);
		const fields = [[1900,1660,1990,1790],[2010,1660,2390,1790],[2410,1660,2790,1790],[2810,1660,2860,1790],[2120,1810,2390,1880],[2490,1810,2790,1870],[2240,2230,2390,2590],[2410,2230,2790,2590],[2060,2240,2190,2590],[1900,2240,1990,2590],[2410,1960,2790,2040],[2140,1960,2390,2185]];
		for (const [w1, s1, w2, s2] of fields)
			el('rect', { x: X(w2), y: Y(s1), width: X(w1) - X(w2), height: Y(s2) - Y(s1), rx: 3, fill: 'var(--ld-farm)' }, g0);
		el('path', { d: `M${X(2030)},${Y(2190)} C${X(2060)},${Y(2150)} ${X(2140)},${Y(2120)} ${X(2160)},${Y(2060)} C${X(2175)},${Y(2020)} ${X(2140)},${Y(2010)} ${X(2120)},${Y(2050)} C${X(2100)},${Y(2100)} ${X(2050)},${Y(2120)} ${X(2015)},${Y(2160)} Z`, fill: 'var(--ld-water)' }, g0);
		el('path', { d: `M${X(1900)},${Y(1960)} C${X(1990)},${Y(1900)} ${X(2050)},${Y(1940)} ${X(2120)},${Y(1915)} S${X(2250)},${Y(1960)} ${X(2330)},${Y(1915)} S${X(2420)},${Y(1930)} ${X(2470)},${Y(1900)} S${X(2620)},${Y(1880)} ${X(2700)},${Y(1860)} S${X(2800)},${Y(1830)} ${X(2860)},${Y(1840)}`, fill: 'none', stroke: 'var(--ld-creek)', 'stroke-width': 4, 'stroke-linecap': 'round' }, g0);
		const roadsW: [number, boolean][] = [[2000, true], [2400, false], [2800, false]];
		const roadsS: [number, boolean][] = [[1700, false], [1800, true], [2200, true]];
		const road = (x1: number, y1: number, x2: number, y2: number, major: boolean, casing: boolean) =>
			el('line', { x1, y1, x2, y2, stroke: casing ? (major ? 'var(--ld-majorcase)' : 'var(--ld-casing)') : major ? 'var(--ld-major)' : 'var(--ld-road)', 'stroke-width': casing ? (major ? 11 : 9) : major ? 8 : 6, 'stroke-linecap': 'round' }, g0);
		for (const casing of [true, false]) {
			for (const [w, m] of roadsW) road(X(w), -50, X(w), 1050, m, casing);
			for (const [s, m] of roadsS) road(-50, Y(s), 1010, Y(s), m, casing);
		}
		const lab = (x: number, y: number, txt: string, rot = false, extra: Record<string, string | number> = {}) => {
			const t = el('text', { x, y, 'font-size': 12, 'text-anchor': 'middle', fill: 'var(--ld-label)', stroke: 'var(--ld-halo)', 'stroke-width': 3, 'paint-order': 'stroke', 'font-weight': 500, ...(rot ? { transform: `rotate(-90 ${x} ${y})` } : {}), ...extra }, g0);
			t.textContent = txt;
		};
		for (const [w] of roadsW) { lab(X(w) - 12, 140, `S ${w} W`, true); lab(X(w) - 12, 820, `S ${w} W`, true); }
		for (const [s] of roadsS) { lab(140, Y(s) - 9, `W ${s} S`); lab(620, Y(s) - 9, `W ${s} S`); }
		lab(X(2620), Y(1860), 'Spring Creek', false, { fill: 'var(--ld-creek)', 'font-style': 'italic' });
		lab(X(2095), Y(2085), 'pond', false, { fill: 'var(--ld-creek)', 'font-style': 'italic', 'font-size': 11 });

		if (dog.hotspot) {
			const h = dog.hotspot;
			el('ellipse', { cx: X(h.w), cy: Y(h.s), rx: h.rw, ry: h.rs, fill: 'var(--ld-hot)', stroke: 'var(--ld-ping)', 'stroke-dasharray': '6 5', 'stroke-width': 1.4 }, g0);
			lab(X(h.w), Y(h.s) - h.rs - 8, 'HOTSPOT', false, { fill: 'var(--ld-ping)', 'font-weight': 700, 'font-size': 11 });
		}
		for (const e of dog.events) {
			if (!e.zone) continue;
			const [w1, s1, w2, s2] = e.zone;
			const c = e.c === 'nogo' ? 'var(--ld-nogo)' : 'var(--ld-seen)';
			el('rect', { x: X(w2), y: Y(s1), width: X(w1) - X(w2), height: Y(s2) - Y(s1), rx: 4, fill: c, 'fill-opacity': 0.1, stroke: c, 'stroke-dasharray': '5 4', 'stroke-width': 1.4 }, g0);
			lab(X(w2) + (X(w1) - X(w2)) / 2, Y(s2) + 16, e.c === 'nogo' ? 'no-go (approx)' : e.zoneKind === 'area' ? 'first search area' : 'seen running in this field', false, { fill: c, 'font-size': 11, 'font-weight': 700 });
		}
		if (dog.home) {
			const x = X(dog.home.w), y = Y(dog.home.s);
			const g = el('g', {}, g0);
			el('circle', { cx: x, cy: y, r: 16, fill: 'var(--ld-fg)', stroke: 'var(--ld-halo)', 'stroke-width': 3 }, g);
			el('path', { d: `M${x - 8},${y + 1} L${x},${y - 7} L${x + 8},${y + 1} M${x - 5},${y - 1} L${x - 5},${y + 7} L${x + 5},${y + 7} L${x + 5},${y - 1}`, fill: 'none', stroke: 'var(--ld-panel)', 'stroke-width': 2, 'stroke-linejoin': 'round' }, g);
			lab(x, y + 32, dog.home.label, false, { fill: 'var(--ld-fg)', 'font-weight': 700 });
		}
		for (const [w, s] of dog.pins ?? []) {
			const g = el('g', { class: 'mk', 'data-k': 'pin' }, g0);
			el('path', { class: 'pinbody', d: `M${X(w)},${Y(s)} c-2,-6 -8,-10 -8,-16 a8,8 0 1,1 16,0 c0,6 -6,10 -8,16 z`, fill: 'var(--ld-pin)', stroke: 'var(--ld-halo)', 'stroke-width': 1.5 }, g);
		}
		let n = 0;
		dog.events.forEach((e, i) => {
			if (e.hide) return;
			numbers[i] = ++n;
			const c = colorOf(e);
			const x = X(e.w), y = Y(e.s);
			const g = el('g', { class: 'mk', 'data-k': e.k }, g0);
			if (e.arrow) el('path', { d: `M${x + 20},${y - 4} l0,-70 m-7,10 l7,-10 l7,10`, stroke: 'var(--ld-seen)', 'stroke-width': 3, fill: 'none', 'stroke-linecap': 'round' }, g);
			if (e.search) el('circle', { class: 'pinbody', cx: x, cy: y, r: 9, fill: 'var(--ld-panel)', stroke: c, 'stroke-width': 2, 'stroke-dasharray': '3 2' }, g);
			else el('path', { class: 'pinbody', d: `M${x},${y} c-3,-9 -13,-14 -13,-25 a13,13 0 1,1 26,0 c0,11 -10,16 -13,25 z`, fill: c, stroke: 'rgba(0,0,0,.25)', 'stroke-width': 1 }, g);
			const t = el('text', { x, y: e.search ? y + 4 : y - 21, 'text-anchor': 'middle', 'font-size': 11, 'font-weight': 700, fill: e.search ? c : '#fff', 'pointer-events': 'none' }, g);
			t.textContent = String(n);
			g.addEventListener('click', () => { if (!dragged) pick(i); });
			marks[i] = g;
		});
		applyFilter();
		applySelection();
	}

	function drawHours() {
		if (!hoursEl) return;
		hoursEl.replaceChildren();
		const L = 40, R = 880, base = 110, x = (h: number) => L + ((R - L) * h) / 24;
		const timed = dog.events.filter((e) => e.h != null).sort((a, b) => (a.h ?? 0) - (b.h ?? 0));
		// Shade the hours that have no reports at all.
		const has = new Set(timed.map((e) => Math.floor(e.h ?? 0)));
		for (let h = 0; h < 24; h++)
			if (!has.has(h)) el('rect', { x: x(h), y: 20, width: x(h + 1) - x(h), height: base - 20, fill: 'var(--ld-line)', 'fill-opacity': 0.35 }, hoursEl);
		if (dog.activeWindow) {
			const [a, b] = dog.activeWindow;
			el('rect', { x: x(a), y: 14, width: x(b) - x(a), height: base - 14, rx: 4, fill: 'var(--ld-hot)', stroke: 'var(--ld-ping)', 'stroke-width': 1 }, hoursEl);
			const t = el('text', { x: (x(a) + x(b)) / 2, y: 12, 'text-anchor': 'middle', 'font-size': 11, 'font-weight': 700, fill: 'var(--ld-ping)' }, hoursEl);
			t.textContent = 'MOST MOVEMENT';
		}
		el('line', { x1: L, y1: base, x2: R, y2: base, stroke: 'var(--ld-muted)', 'stroke-width': 1 }, hoursEl);
		for (let h = 0; h <= 24; h += 3) {
			el('line', { x1: x(h), y1: base, x2: x(h), y2: base + 5, stroke: 'var(--ld-muted)' }, hoursEl);
			const t = el('text', { x: x(h), y: base + 20, 'text-anchor': 'middle', 'font-size': 11, fill: 'var(--ld-muted)' }, hoursEl);
			t.textContent = h === 0 || h === 24 ? '12am' : h === 12 ? '12pm' : h < 12 ? `${h}am` : `${h - 12}pm`;
		}
		const stack: Record<number, number> = {};
		for (const e of timed) {
			const b = Math.floor((e.h ?? 0) * 2) / 2;
			const k = (stack[b] = (stack[b] ?? 0) + 1);
			const c = e.k === 'seen' ? 'var(--ld-seen)' : 'var(--ld-ping)';
			const m = el('circle', { cx: x(e.h ?? 0), cy: base - 8 - (k - 1) * 16, r: 6.5, fill: e.mv ? 'var(--ld-panel)' : c, stroke: c, 'stroke-width': 2.2 }, hoursEl);
			const tt = el('title', {}, m);
			tt.textContent = `${e.d} ${e.t} · ${e.who}`;
		}
		const lg = el('text', { x: R, y: base + 38, 'text-anchor': 'end', 'font-size': 11, fill: 'var(--ld-muted)' }, hoursEl);
		lg.textContent = '● same spot as last report   ○ had moved   red = ping · blue = seen';
	}

	function setFilter(f: string) {
		filter = f as typeof filter;
	}
	function applyFilter() {
		mapEl?.querySelectorAll<SVGGElement>('.mk').forEach((m) => {
			m.classList.toggle('dim', !(filter === 'all' || m.dataset.k === filter));
		});
	}
	function applySelection() {
		marks.forEach((m, j) => m?.classList.toggle('sel', j === selected));
	}
	function pick(i: number) {
		selected = selected === i ? null : i;
		applySelection();
		if (selected !== null && window.innerWidth <= 880 && marks[selected]) mapEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
	}

	// Pan and zoom by moving the viewBox.
	let dragged = false;
	let p0: { x: number; y: number; v: number[] } | null = null;
	const setView = () => mapEl?.setAttribute('viewBox', view.join(' '));
	function zoom(f: number) {
		const cx = view[0] + view[2] / 2, cy = view[1] + view[3] / 2;
		const w = Math.min(1600, Math.max(200, view[2] * f));
		view = [cx - w / 2, cy - (w * 1000) / 960 / 2, w, (w * 1000) / 960];
		setView();
	}
	function down(e: PointerEvent) { p0 = { x: e.clientX, y: e.clientY, v: [...view] }; dragged = false; }
	function move(e: PointerEvent) {
		if (!p0) return;
		const k = view[2] / mapEl.getBoundingClientRect().width;
		const dx = e.clientX - p0.x, dy = e.clientY - p0.y;
		if (Math.abs(dx) + Math.abs(dy) > 4) dragged = true;
		view = [p0.v[0] - dx * k, p0.v[1] - dy * k, view[2], view[3]];
		setView();
	}
	function up() { p0 = null; setTimeout(() => (dragged = false), 0); }

	onMount(() => {
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
	{#if dog.summary}
		<div class="now">
			{#if dog.summary.lastKnown}<div class="card"><b>Last known</b>{dog.summary.lastKnown}</div>{/if}
			{#if dog.summary.hotspot}<div class="card"><b>Hotspot</b>{dog.summary.hotspot}</div>{/if}
			{#if dog.summary.mostActive}<div class="card hl"><b>Most active</b>{dog.summary.mostActive}</div>{/if}
		</div>
	{/if}

	<section class="act">
		<h2>When he's been found, by hour</h2>
		<p>Each mark is one ping or sighting with a known time. Hollow marks are where he had moved since the last report. A ping only happens when an iPhone passes him, so hours when people were out searching are over-counted.</p>
		<div class="hscroll"><svg bind:this={hoursEl} viewBox="0 0 900 150" class="hours" role="img" aria-label="Pings and sightings by hour of day"></svg></div>
	</section>

	<div class="grid">
		<div class="mapbox">
			<!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
			<svg bind:this={mapEl} viewBox="0 0 960 1000" class="map" role="img" aria-label="Map of {dog.name} sightings"
				on:pointerdown={down} on:pointermove={move} on:pointerup={up} on:pointercancel={up}></svg>
			<div class="zoom">
				<button type="button" aria-label="Zoom in" on:click={() => zoom(0.7)}>+</button>
				<button type="button" aria-label="Zoom out" on:click={() => zoom(1 / 0.7)}>−</button>
				<button type="button" aria-label="Reset view" on:click={() => { view = [0, 0, 960, 1000]; setView(); }}>⟲</button>
			</div>
			<div class="legend">
				<span><i class="dot" style="background:var(--ld-ping)"></i>AirTag ping</span>
				<span><i class="dot" style="background:var(--ld-seen)"></i>seen by a person</span>
				<span><i class="dot" style="background:var(--ld-pin)"></i>saved pin (no date)</span>
				<span><i class="dot" style="background:var(--ld-nogo)"></i>stay off</span>
				<span><i class="dot" style="background:var(--ld-ok)"></i>OK to search</span>
			</div>
		</div>
		<div>
			<div class="filters" role="group" aria-label="Filter">
				{#each [['all', 'All'], ['ping', 'Pings'], ['seen', 'Seen'], ['land', 'Land / access']] as [f, label]}
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
								<span class="n" style="background:{colorOf(e)}">{numbers[i] ?? '·'}</span>
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
		--ld-ping:#ea4335; --ld-seen:#4285f4; --ld-pin:#a142f4; --ld-nogo:#d93025; --ld-ok:#188038; --ld-hot:rgba(234,67,53,.12);
		color: var(--ld-fg);
	}
	@media (prefers-color-scheme: dark) {
		.ld {
			--ld-panel:#202124; --ld-fg:#e8eaed; --ld-muted:#9aa0a6; --ld-line:#3c4043;
			--ld-land:#242f3e; --ld-farm:#263c3f; --ld-road:#38414e; --ld-casing:#212a37; --ld-major:#746855; --ld-majorcase:#1f2835;
			--ld-water:#17263c; --ld-creek:#3a6ea5; --ld-label:#9ca5b3; --ld-halo:#17263c;
			--ld-ping:#f28b82; --ld-seen:#8ab4f8; --ld-pin:#c58af9; --ld-nogo:#f28b82; --ld-ok:#81c995; --ld-hot:rgba(242,139,130,.14);
		}
	}
	.now { display:grid; grid-template-columns:repeat(auto-fit,minmax(240px,1fr)); gap:12px; margin-bottom:12px; }
	.card { background:var(--ld-panel); border:1px solid var(--ld-line); border-radius:8px; padding:12px 14px; min-width:0; }
	.card b { display:block; font-size:.72rem; letter-spacing:.08em; text-transform:uppercase; color:var(--ld-muted); font-weight:700; margin-bottom:2px; }
	.card.hl { border-color:var(--ld-ping); }
	.act { margin-bottom:16px; }
	.act h2 { font-size:1rem; font-weight:600; margin:0 0 2px; }
	.act p { margin:0 0 6px; color:var(--ld-muted); font-size:.9rem; max-width:80ch; }
	.hscroll { overflow-x:auto; }
	.hours { width:100%; min-width:560px; height:auto; display:block; }
	.grid { display:grid; grid-template-columns:minmax(0,1.45fr) minmax(0,1fr); gap:16px; align-items:start; }
	@media (max-width:880px) { .grid { grid-template-columns:1fr; } }
	.mapbox { position:relative; background:var(--ld-panel); border:1px solid var(--ld-line); border-radius:8px; overflow:hidden; }
	.map { width:100%; height:auto; display:block; touch-action:none; cursor:grab; background:var(--ld-land); }
	.zoom { position:absolute; right:10px; bottom:52px; display:flex; flex-direction:column; background:var(--ld-panel); border-radius:6px; box-shadow:0 1px 4px rgba(0,0,0,.3); overflow:hidden; }
	.zoom button { width:36px; height:36px; border:0; background:var(--ld-panel); color:var(--ld-muted); font-size:20px; cursor:pointer; }
	.zoom button + button { border-top:1px solid var(--ld-line); }
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
	.map :global(.mk.dim) { opacity:.15; }
	.map :global(.mk.sel .pinbody) { stroke:var(--ld-fg); stroke-width:2.5; }
	.map :global(text) { font-family:inherit; }
</style>
