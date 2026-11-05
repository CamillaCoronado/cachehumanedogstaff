import type { LostDog } from './lostDogs';

/** Pretzel's search, from #woof-crew and #dog-staff (10/27–11/4). Positions are on the county road grid. */
export const PRETZEL: LostDog = {
	"name": "Pretzel",
	"status": "missing",
	"home": {
		"w": 2081,
		"s": 2216,
		"label": "Foster home (escaped here)",
		"address": "2200 S 2081 W, Wellsville, UT 84339"
	},
	"hotspot": {
		"w": 2060,
		"s": 2160,
		"rw": 110,
		"rs": 72
	},
	"pingWindow": [
		7,
		8
	],
	"activeWindow": [
		9.5,
		12.6
	],
	"summary": {
		"lastKnown": "11/4 morning ping at ~2114 W 2200 S, north side of the pond. The 11/3 ~11pm and 11/4 2:21am pings were in the same spot.",
		"hotspot": "11 of 16 AirTag pings are within about a block of the foster home at 2081 W 2200 S. He keeps circling back to where he escaped.",
		"mostActive": "Most pings (near houses and the street): 7–8am. 4 pings on 4 different mornings (10/28, 10/29, 11/3, 11/4), all by the foster home on 2200 S. Next most: 11pm–midnight (3 pings). Most movement: late morning to midday. On 10/31 he covered about half a mile between 11:20am and 12:20pm."
	},
	"events": [
		{
			"d": "10/27",
			"t": "4:50 pm",
			"k": "land",
			"w": 1990,
			"s": 2400,
			"who": "Elizabeth",
			"q": "Pretzel escaped his foster home. He is dragging his leash. The airtag doesn't update consistently enough for more than a general vicinity.",
			"c": "context",
			"channel": "#dog-staff",
			"link": "https://cachehumane.slack.com/archives/C0LEAK093/p1793141417513059",
			"h": 16.83,
			"hide": true
		},
		{
			"d": "10/27",
			"t": "4:53 pm",
			"k": "ping",
			"w": 2000,
			"s": 2400,
			"who": "Elizabeth",
			"q": "He's in the vicinity of 2000 W in Wellsville, somewhere between 2200 and 2600 S.",
			"c": "area",
			"channel": "#dog-staff",
			"link": "https://cachehumane.slack.com/archives/C0LEAK093/p1793141625977309",
			"h": 16.88,
			"mv": true,
			"zone": [
				1950,
				2200,
				2050,
				2600
			],
			"zoneKind": "area"
		},
		{
			"d": "10/27",
			"t": "~10:17 pm",
			"k": "ping",
			"w": 2010,
			"s": 2107,
			"who": "Liz",
			"q": "Pretzel pinged… My cell number is connected to the air tag if they scan it.",
			"c": "exact",
			"channel": "#woof-crew",
			"link": "https://cachehumane.slack.com/archives/C037C2KUZDF/p1793162562364649",
			"h": 22.28,
			"addr": "2107 S 2000 W",
			"mv": true
		},
		{
			"d": "10/27",
			"t": "11:37 pm",
			"k": "seen",
			"w": 1996,
			"s": 2128,
			"who": "Mellissa",
			"q": "He just ran past my car… covered in mud feet soaked but he's alive. That's the white house on corner he ran from.",
			"c": "approx",
			"channel": "#woof-crew",
			"link": "https://cachehumane.slack.com/archives/C037C2KUZDF/p1793165842335779",
			"h": 23.62
		},
		{
			"d": "10/28",
			"t": "7:15 am",
			"k": "ping",
			"w": 2016,
			"s": 2101,
			"who": "Liz",
			"q": "7:15 it pinged and he's still in that area",
			"c": "exact",
			"channel": "#woof-crew",
			"link": "https://cachehumane.slack.com/archives/C037C2KUZDF/p1793197265634169",
			"h": 7.25,
			"addr": "2107 S 2000 W"
		},
		{
			"d": "10/28",
			"t": "9:30 am",
			"k": "land",
			"w": 2040,
			"s": 2140,
			"who": "Collie",
			"q": "No luck on foot. It's the field we were first checking.",
			"c": "context",
			"channel": "#woof-crew",
			"link": "https://cachehumane.slack.com/archives/C037C2KUZDF/p1793201434920689",
			"hide": true
		},
		{
			"d": "10/28",
			"t": "4:44 pm",
			"k": "land",
			"w": 2010,
			"s": 2107,
			"who": "Collie",
			"q": "The Apple tag has still remained pinged at this morning's location. (No new ping all day.)",
			"c": "context",
			"channel": "#woof-crew",
			"link": "https://cachehumane.slack.com/archives/C037C2KUZDF/p1793227444223199",
			"hide": true
		},
		{
			"d": "10/29",
			"t": "7:46 am",
			"k": "ping",
			"w": 2008,
			"s": 2175,
			"who": "Camilla",
			"q": "AirTag screenshot: 2175 S 2000 W, Oct 29 at 7:46 AM.",
			"c": "exact",
			"channel": "#woof-crew",
			"link": "https://cachehumane.slack.com/archives/C037C2KUZDF/p1793284347624979",
			"h": 7.77,
			"addr": "2175 S 2000 W"
		},
		{
			"d": "10/29",
			"t": "1:28 pm",
			"k": "land",
			"w": 2034,
			"s": 2166,
			"who": "Collie",
			"q": "Permission from the land owner at the house Pretzel keeps getting sighted at to look in the back area. Talk to her niece first (house at the entrance).",
			"c": "ok",
			"channel": "#woof-crew",
			"link": "https://cachehumane.slack.com/archives/C037C2KUZDF/p1793302136481089",
			"addr": "2175 S 2000 W"
		},
		{
			"d": "10/30",
			"t": "~4:21 pm",
			"k": "ping",
			"w": 2060,
			"s": 1925,
			"who": "Liz",
			"q": "IT PINGED 7 min AGO. (Elizabeth: we were out there half an hour ago.) Ping sits on Spring Creek, 1800 S just north.",
			"c": "approx",
			"channel": "#woof-crew",
			"link": "https://cachehumane.slack.com/archives/C037C2KUZDF/p1793399298874419",
			"h": 16.35,
			"mv": true
		},
		{
			"d": "10/30",
			"t": "5:31 pm",
			"k": "clue",
			"w": 2042,
			"s": 1946,
			"who": "Elizabeth",
			"q": "Geothermal guy said there's a heat source right there.",
			"c": "approx",
			"channel": "#woof-crew",
			"link": "https://cachehumane.slack.com/archives/C037C2KUZDF/p1793403106435799",
			"h": 17.52
		},
		{
			"d": "10/30",
			"t": "6:11 pm",
			"k": "clue",
			"w": 2078,
			"s": 1952,
			"who": "Elizabeth",
			"q": "Found what is probably dog poop! He's been eating random plants.",
			"c": "approx",
			"channel": "#woof-crew",
			"link": "https://cachehumane.slack.com/archives/C037C2KUZDF/p1793405507872649",
			"h": 18.18
		},
		{
			"d": "10/30",
			"t": "6:46 pm",
			"k": "land",
			"w": 2010,
			"s": 1990,
			"who": "Elizabeth",
			"q": "Property owner does not want people on his land. He had a gun. Stick to the roads. (Red X on her sketch: south of the creek, east of the ping.)",
			"c": "nogo",
			"channel": "#woof-crew",
			"link": "https://cachehumane.slack.com/archives/C037C2KUZDF/p1793407571670829",
			"zone": [
				1950,
				1955,
				2075,
				2040
			]
		},
		{
			"d": "10/30",
			"t": "11:59 pm",
			"k": "land",
			"w": 2173,
			"s": 2212,
			"who": "Elizabeth",
			"q": "Approval only from the white house, 2173 W 2200 S, and Tuesday night's house. Not 1929 S 2000 W. Owner north of the river is unknown.",
			"c": "ok",
			"channel": "#woof-crew",
			"link": "https://cachehumane.slack.com/archives/C037C2KUZDF/p1793425860462899",
			"addr": "2173 W 2200 S"
		},
		{
			"d": "10/31",
			"t": "~9:42 am",
			"k": "ping",
			"w": 2128,
			"s": 2206,
			"who": "Liz",
			"q": "Ping on 2200 S. Elizabeth: that is by the nice people's property, they own the field directly west of that house.",
			"c": "approx",
			"channel": "#woof-crew",
			"link": "https://cachehumane.slack.com/archives/C037C2KUZDF/p1793425860462899",
			"h": 9.7,
			"mv": true
		},
		{
			"d": "10/31",
			"t": "~11:23 am",
			"k": "ping",
			"w": 2012,
			"s": 2192,
			"who": "Liz",
			"q": "Find My: \"This item was seen near 2010 W 2200 S.\"",
			"c": "exact",
			"channel": "#woof-crew",
			"link": "https://cachehumane.slack.com/archives/C037C2KUZDF/p1793469348866329",
			"h": 11.38,
			"addr": "2010 W 2200 S",
			"mv": true
		},
		{
			"d": "10/31",
			"t": "~12:01 pm",
			"k": "ping",
			"w": 2006,
			"s": 2206,
			"who": "Liz",
			"q": "Find My alert, \"now\": \"This item was seen near 2010 W 2200 S.\" Liz: \"I'm getting a few pings back to back.\"",
			"c": "exact",
			"channel": "#woof-crew",
			"link": "https://cachehumane.slack.com/archives/C037C2KUZDF/p1793469718300619",
			"h": 12,
			"addr": "2010 W 2200 S"
		},
		{
			"d": "10/31",
			"t": "~12:01 pm",
			"k": "ping",
			"w": 2320,
			"s": 2195,
			"who": "Liz",
			"q": "Latest ping was by the church!!! (back-to-back pings)",
			"c": "approx",
			"channel": "#woof-crew",
			"link": "https://cachehumane.slack.com/archives/C037C2KUZDF/p1793470101965819",
			"h": 12.02,
			"mv": true
		},
		{
			"d": "10/31",
			"t": "12:09 pm",
			"k": "land",
			"w": 2010,
			"s": 2218,
			"who": "Mellissa",
			"q": "Just set up a kennel at 20:10 [2010 W]. They allowed it.",
			"c": "ok",
			"channel": "#woof-crew",
			"link": "https://cachehumane.slack.com/archives/C037C2KUZDF/p1793470154748309",
			"addr": "~2010 W 2200 S"
		},
		{
			"d": "10/31",
			"t": "12:17 pm",
			"k": "seen",
			"w": 2400,
			"s": 2080,
			"who": "Mellissa",
			"q": "Found him, he is on twenty four hundred west going north. …He went behind a house.",
			"c": "approx",
			"channel": "#woof-crew",
			"link": "https://cachehumane.slack.com/archives/C037C2KUZDF/p1793470636824299",
			"h": 12.28,
			"mv": true,
			"arrow": true
		},
		{
			"d": "10/31",
			"t": "~12:18 pm",
			"k": "ping",
			"w": 2425,
			"s": 1952,
			"who": "Liz",
			"q": "Pings just west of 2400 W, south of Spring Creek (1 and 4 min old).",
			"c": "approx",
			"channel": "#woof-crew",
			"link": "https://cachehumane.slack.com/archives/C037C2KUZDF/p1793470803182209",
			"h": 12.3,
			"mv": true
		},
		{
			"d": "10/31",
			"t": "12:29 pm",
			"k": "clue",
			"w": 2400,
			"s": 1700,
			"who": "Mellissa",
			"q": "K I'm on 1700 S 2400 West. (searching, not a sighting)",
			"c": "approx",
			"channel": "#woof-crew",
			"link": "https://cachehumane.slack.com/archives/C037C2KUZDF/p1793471397156689",
			"search": true
		},
		{
			"d": "11/1",
			"t": "~3:32 pm",
			"k": "ping",
			"w": 2470,
			"s": 1838,
			"who": "Liz",
			"q": "Ping just south of 1800 S, west of 2400 W (Phoenix Tears Nursery to the east).",
			"c": "approx",
			"channel": "#woof-crew",
			"link": "https://cachehumane.slack.com/archives/C037C2KUZDF/p1793573539394329",
			"h": 15.53,
			"mv": true
		},
		{
			"d": "11/2",
			"t": "11:27 am",
			"k": "land",
			"w": 2000,
			"s": 2200,
			"who": "Mellissa / Elizabeth",
			"q": "\"Any new update on location today?\" \"No.\" (No pings from 11/1 afternoon to 11/2 late morning.)",
			"c": "context",
			"channel": "#woof-crew",
			"link": "https://cachehumane.slack.com/archives/C037C2KUZDF/p1793644025000049",
			"hide": true
		},
		{
			"d": "11/3",
			"t": "≤7:10 am",
			"k": "ping",
			"w": 2004,
			"s": 2179,
			"who": "Elizabeth",
			"q": "Back where he was a few days ago, the house where Mellissa left the kennel. (Collie: \"Do not go on the Hansen land.\")",
			"c": "exact",
			"channel": "#woof-crew",
			"link": "https://cachehumane.slack.com/archives/C037C2KUZDF/p1793715044146329",
			"h": 7.1,
			"addr": "2175 S 2000 W",
			"mv": true
		},
		{
			"d": "11/3",
			"t": "~11:11 pm",
			"k": "ping",
			"w": 2095,
			"s": 2185,
			"who": "Liz",
			"q": "Ping south of the pond, just north of 2200 S.",
			"c": "approx",
			"channel": "#woof-crew",
			"link": "https://cachehumane.slack.com/archives/C037C2KUZDF/p1793773928869749",
			"h": 23.18
		},
		{
			"d": "11/3",
			"t": "~11:23 pm",
			"k": "ping",
			"w": 2116,
			"s": 2190,
			"who": "Liz",
			"q": "Second ping a little west, still north of 2200 S.",
			"c": "approx",
			"channel": "#woof-crew",
			"link": "https://cachehumane.slack.com/archives/C037C2KUZDF/p1793774524846989",
			"h": 23.38
		},
		{
			"d": "11/4",
			"t": "2:21 am",
			"k": "ping",
			"w": 2105,
			"s": 2180,
			"who": "Liz",
			"q": "He keeps pinging around in the area. (no screenshot; same area as the 11pm pings)",
			"c": "approx",
			"channel": "#woof-crew",
			"link": "https://cachehumane.slack.com/archives/C037C2KUZDF/p1793784101803269",
			"h": 2.35
		},
		{
			"d": "11/4",
			"t": "morning",
			"k": "ping",
			"w": 2112,
			"s": 2197,
			"who": "Elizabeth",
			"q": "He pinged at 2114 W 2200 S this morning. Leave food at the edge of the field west of that address. Mind the electric fence. Maybe next to the church as well.",
			"c": "exact",
			"channel": "#woof-crew",
			"link": "https://cachehumane.slack.com/archives/C037C2KUZDF/p1793805648327259",
			"h": 7.6,
			"addr": "2114 W 2200 S"
		},
		{
			"d": "11/4",
			"t": "time unknown",
			"k": "clue",
			"w": 2600,
			"s": 2120,
			"who": "Mellissa",
			"q": "Posted 11/4 with no date; most likely where she saw him on 10/31 (2400 W heading north), not a separate sighting. \"That's where I seen him running thru field.\" North of 2200 S, 2400–2800 W. Cow pasture with electric fencing; owners are nice, ask first.",
			"c": "area",
			"channel": "#woof-crew",
			"link": "https://cachehumane.slack.com/archives/C037C2KUZDF/p1793809140942509",
			"zone": [
				2420,
				2045,
				2790,
				2200
			],
			"zoneKind": "field"
		},
		{
			"d": "11/4",
			"t": "8:41 am",
			"k": "land",
			"w": 2300,
			"s": 2240,
			"who": "Elizabeth",
			"q": "In contact with a trapper. She is out of town until tomorrow but is going to help us secure him.",
			"c": "context",
			"channel": "#woof-crew",
			"link": "https://cachehumane.slack.com/archives/C037C2KUZDF/p1793806902617019",
			"hide": true
		}
	],
	"pins": [
		[
			1994,
			2113
		],
		[
			2029,
			2120
		],
		[
			2090,
			2198
		],
		[
			2386,
			2253
		],
		[
			2363,
			1924
		],
		[
			2466,
			1835
		],
		[
			1987,
			2332
		],
		[
			1912,
			2200
		]
	],
	"id": "pretzel"
};

export const LOST_DOGS: LostDog[] = [PRETZEL];
