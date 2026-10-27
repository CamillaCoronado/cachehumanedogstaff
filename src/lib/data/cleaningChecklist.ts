import type { CleaningShift } from '$lib/data/cleaning';

/**
 * The cleaning checklists, transcribed from the sheets posted in the dog area
 * (incl. handwritten additions; struck-out lines dropped). Staff A / Staff B
 * each get their own list. Sundays use the Sunday sheets instead of the
 * regular ones. Weekly chores (Mon–Fri) show under the PM "Weekly chores" line.
 */

export type StaffRole = 'A' | 'B';

/** Dashboard tiles that a task counts toward. */
export type ChecklistTag = 'cleaning' | 'movement' | 'slack';

export interface ChecklistTask {
	id: string;
	description: string;
	/** Extra line under the task (e.g. today's weekly chore). */
	detail?: string;
	tag?: ChecklistTag;
}

export interface ChecklistSection {
	staff: StaffRole;
	/** Sunday split, e.g. "East side". */
	side?: string;
	/** e.g. "First on call for meet and greets…". */
	subtitle?: string;
	tasks: ChecklistTask[];
}

export interface ChecklistSheet {
	title: string;
	note?: string;
	footer?: string;
	sections: ChecklistSection[];
}

const STAFF_A_ON_CALL = 'First on call for meet and greets, owner surrenders, foster supplies, etc.';
const CLEANING_FIRST = 'Cleaning takes precedence over enrichment!';
const WEEKLY_CHORES_ID = 'weekly-chores';

const morning: ChecklistSheet = {
	title: 'Morning Tasks',
	note: 'The first person to arrive sets up the dishwasher. Both staff members do a visual check on all dogs. Report any signs of illness to clinic right away. Both staff grab a walkie.',
	footer: `Once completed, begin enrichment, side projects, etc. ${CLEANING_FIRST}`,
	sections: [
		{
			staff: 'A',
			subtitle: STAFF_A_ON_CALL,
			tasks: [
				{ id: 'am-a-dogs-out', description: 'Move all dogs to their outdoor kennels', tag: 'movement' },
				{ id: 'am-a-water', description: 'Give every dog water, taking care to clip buckets to prevent spilling' },
				{ id: 'am-a-feed', description: 'Feed dogs according to the food chart. Do not feed dogs scheduled for surgery.' },
				{ id: 'am-a-scoop-outside', description: 'Scoop poop outside' },
				{ id: 'am-a-laundry', description: 'Laundry' },
				{ id: 'am-a-collect-bowls', description: 'Collect food bowls' },
				{ id: 'am-a-dishes', description: 'Wash dishes. Rinse totes and replace towels' },
				{ id: 'am-a-help-setup', description: 'If all dogs are coming back inside, help set up indoor kennels' },
				{ id: 'am-a-bring-in', description: 'Bring dogs inside as needed' },
				{ id: 'am-a-scoop-remaining', description: 'Scoop any remaining poop' },
				{ id: 'am-a-trash', description: 'Take out the trash' },
				{ id: 'am-a-slack', description: 'Slack update', tag: 'slack' }
			]
		},
		{
			staff: 'B',
			tasks: [
				{ id: 'am-b-dogs-out', description: 'Move all dogs to their outdoor kennels', tag: 'movement' },
				{ id: 'am-b-collect', description: 'Collect all dishes, buckets, toys, and soiled blankets' },
				{ id: 'am-b-scoop', description: 'Scoop all solid waste- kibble, garbage, etc' },
				{
					id: 'am-b-spray',
					description: "Spray all used kennels with Wysiwash. Hang Kuranda beds on the kennel wall after they've been sprayed",
					tag: 'cleaning'
				},
				{ id: 'am-b-wysiwash-flush', description: 'Remove the Wysiwash capsule and flush the unit with plain water' },
				{ id: 'am-b-squeegee', description: 'Squeegee walkways and kennels. Towel dry beds/floors if dogs are coming inside' },
				{ id: 'am-b-drain', description: 'Run the drain for approximately 3 minutes to clear debris. Clean the end basket' },
				{ id: 'am-b-scoop-bucket', description: 'Dump and rinse the poop scoop bucket. Refill with Accel' },
				{ id: 'am-b-setup', description: 'Set up kennels for any dogs coming inside' },
				{ id: 'am-b-bring-in', description: 'Bring dogs inside as needed' },
				{ id: 'am-b-slack', description: 'Slack update', tag: 'slack' },
				{ id: 'am-b-put-away-gear', description: 'Put away leashes + harnesses' }
			]
		}
	]
};

const evening: ChecklistSheet = {
	title: 'Evening Tasks',
	note: 'Both staff members do a visual check on all dogs. Report any signs of illness to clinic right away. Both staff grab a walkie.',
	footer: `Begin enrichment, side projects, etc. ${CLEANING_FIRST}`,
	sections: [
		{
			staff: 'A',
			subtitle: STAFF_A_ON_CALL,
			tasks: [
				{ id: 'pm-a-waters', description: 'Refill waters' },
				{ id: `pm-a-${WEEKLY_CHORES_ID}`, description: 'Weekly chores' },
				{ id: 'pm-a-enrichment', description: 'Enrichment' },
				{ id: 'pm-a-dogs-out', description: 'Move all dogs to their outdoor kennels around 2:30.' },
				{ id: 'pm-a-feed', description: 'Feed' },
				{ id: 'pm-a-bowls', description: 'Collect and wash food bowls' },
				{ id: 'pm-a-bring-in', description: 'Bring all dogs inside around 4:00', tag: 'movement' },
				{ id: 'pm-a-collect-buckets', description: 'Collect water buckets and toys' },
				{ id: 'pm-a-dishes', description: 'Wash all dishes. Rinse totes and replace towels.' },
				{ id: 'pm-a-second-meals', description: 'Give second meals' },
				{ id: 'pm-a-freyja', description: 'Feed and water Freyja. Clean her litter box!' },
				{ id: 'pm-a-laundry', description: 'Move laundry along. Do not start the dryer if you will be leaving before it finishes.' }
			]
		},
		{
			staff: 'B',
			tasks: [
				{ id: 'pm-b-hang-gear', description: 'Hang leashes + harnesses + replace Accel' },
				{ id: 'pm-b-laundry', description: 'Laundry' },
				{ id: `pm-b-${WEEKLY_CHORES_ID}`, description: 'Weekly chores' },
				{ id: 'pm-b-enrichment', description: 'Enrichment' },
				{ id: 'pm-b-dogs-out', description: 'Move all dogs to their outdoor kennels around 2:30.' },
				{ id: 'pm-b-prep-indoor', description: 'Prepare the indoor kennels. Spot clean as needed. Pass out/refill waters, treats, and toys' },
				{ id: 'pm-b-bring-in', description: 'Bring all dogs inside around 4:00', tag: 'movement' },
				{ id: 'pm-b-scoop', description: 'Scoop poop' },
				{
					id: 'pm-b-spray',
					description:
						'Spray the outdoor kennels with Wysiwash if the temperature is above 40 F. Remove Wysiwash capsule and rinse the unit with plain water. Scoop any hair/dirt clumps',
					tag: 'cleaning'
				},
				{ id: 'pm-b-too-cold', description: "If it's too cold to spray, work on snow removal and spray with Accel.", tag: 'cleaning' },
				{ id: 'pm-b-trash', description: 'Take out trash' },
				{ id: 'pm-b-final-check', description: 'Final check on all dogs. Turn out the lights and lock the door.' },
				{ id: 'pm-b-slack', description: 'Slack update', tag: 'slack' }
			]
		}
	]
};

const SUNDAY_SCRUB_ALL =
	'Scrub ALL of dog spot with Accel: walls to about shoulder height, higher if needed. Scrub walkways and entirety of ALL kennels- tops, sides, floor, drain cover, drain, Kuranda beds front/back/legs. Doors should also be Accelled. Kennels that were not used the previous night still need to be scrubbed.';
const SUNDAY_RINSE_MOP =
	'Rinse the mop bucket and return it to the Accel closet. Rinse the scrub brush with plain water before hanging it up';

const sundayMorning: ChecklistSheet = {
	title: 'Sunday Morning Tasks',
	note: 'The first person to arrive sets up the dishwasher. Both staff members do a visual check on all dogs. Report any signs of illness to clinic right away.',
	footer: 'Any remaining time should be used for enrichment.',
	sections: [
		{
			staff: 'A',
			side: 'East side',
			tasks: [
				{ id: 'sun-am-a-dogs-out', description: 'Move all dogs to their outdoor kennels', tag: 'movement' },
				{ id: 'sun-am-a-water', description: 'Give every dog water, taking care to clip buckets to prevent spilling, if over 65°' },
				{ id: 'sun-am-a-feed', description: 'Feed dogs according to the food chart.' },
				{ id: 'sun-am-a-scoop-outside', description: 'Scoop poop outside' },
				{ id: 'sun-am-a-laundry', description: 'Laundry' },
				{ id: 'sun-am-a-collect-bowls', description: 'Collect food bowls' },
				{ id: 'sun-am-a-help-prep', description: 'Help Staff B finish prepping for cleaning as needed' },
				{
					id: 'sun-am-a-deep-clean',
					description:
						'Deep clean East side of dog spot. Spray walls, walkways, kennels from top to bottom, drain covers, and the center drain. Remove drain covers so they can be scrubbed.'
				},
				{ id: 'sun-am-a-scrub', description: SUNDAY_SCRUB_ALL, tag: 'cleaning' },
				{ id: 'sun-am-a-rinse-mop', description: SUNDAY_RINSE_MOP },
				{ id: 'sun-am-a-rinse', description: 'Rinse walls, walkways, and kennels. Replace drain covers.' },
				{ id: 'sun-am-a-squeegee', description: 'Squeegee walkways and kennels' },
				{ id: 'sun-am-a-dishes', description: 'Wash dishes' },
				{ id: 'sun-am-a-inside-water', description: 'Fill and pass out water buckets for inside kennels' },
				{ id: 'sun-am-a-help-setup', description: 'Help finish setting up kennels as needed' },
				{ id: 'sun-am-a-bring-in', description: 'Bring all dogs inside' },
				{ id: 'sun-am-a-scoop-trash', description: 'Scoop any remaining poop and take out the trash' },
				{ id: 'sun-am-a-slack', description: 'Slack update', tag: 'slack' }
			]
		},
		{
			staff: 'B',
			side: 'West Side',
			tasks: [
				{ id: 'sun-am-b-dogs-out', description: 'Move all dogs to their outdoor kennels', tag: 'movement' },
				{ id: 'sun-am-b-collect', description: 'Collect all dishes, buckets, toys, and soiled blankets from indoor kennels' },
				{ id: 'sun-am-b-scoop', description: 'Scoop all solid waste- poop, kibble, garbage, etc' },
				{
					id: 'sun-am-b-clear-spot',
					description:
						'Clear dog spot for cleaning: Remove guillotine pins. Move all poop scoops, garbage cans, leash bucket, carts, daytrip bags, vest/collar drawers, fans, etc to the hallways or outside. Any used foster crates need to be sprayed with Accel and placed on the shelf'
				},
				{ id: 'sun-am-b-harnesses', description: "Label all harnesses with the dogs' names and masking tape. Soak them all in Accel." },
				{ id: 'sun-am-b-daytrip', description: 'Reset the daytrip board and take all used daytrip bowls to the extension' },
				{
					id: 'sun-am-b-deep-clean',
					description:
						'Deep clean West side of dog spot. Spray walls, walkways, kennels from top to bottom, behind the white kennels, and the center drain'
				},
				{
					id: 'sun-am-b-scrub',
					description: `${SUNDAY_SCRUB_ALL} White kennels can be sprayed with Accel if there is no visible debris.`,
					tag: 'cleaning'
				},
				{ id: 'sun-am-b-rinse-mop', description: SUNDAY_RINSE_MOP },
				{ id: 'sun-am-b-rinse', description: 'Rinse walls, walkways, and kennels' },
				{ id: 'sun-am-b-squeegee', description: 'Squeegee walkways and kennels. Towel dry all kennels that will house a dog' },
				{ id: 'sun-am-b-setup', description: 'Setup kennels with beds/blankets, toys, and treats' },
				{ id: 'sun-am-b-bring-in', description: 'Bring all dogs inside' },
				{ id: 'sun-am-b-laundry', description: 'Laundry' },
				{ id: 'sun-am-b-final-check', description: 'Final check on all dogs. Turn out the lights and lock the door.' },
				{ id: 'sun-am-b-slack', description: 'Slack update', tag: 'slack' }
			]
		}
	]
};

const sundayEvening: ChecklistSheet = {
	title: 'Sunday Evening Tasks',
	footer: `Begin enrichment, side projects, etc. ${CLEANING_FIRST}`,
	sections: [
		{
			staff: 'A',
			tasks: [
				{ id: 'sun-pm-a-dogs-out', description: 'Move all dogs to their outdoor kennels' },
				{ id: 'sun-pm-a-feed', description: 'Feed' },
				{ id: 'sun-pm-a-laundry', description: 'Laundry' },
				{ id: 'sun-pm-a-bowls', description: 'Collect and wash food bowls' },
				{ id: 'sun-pm-a-bring-in', description: 'Bring all dogs inside around 4:00', tag: 'movement' },
				{ id: 'sun-pm-a-collect-buckets', description: 'Collect water buckets and toys' },
				{ id: 'sun-pm-a-dishes', description: 'Wash all dishes. Rinse totes and replace towels.' },
				{ id: 'sun-pm-a-second-meals', description: 'Give second meals' },
				{ id: 'sun-pm-a-freyja', description: 'Feed and water Freyja. Clean her litter box!' },
				{
					id: 'sun-pm-a-hair-clumps',
					description: 'Pick up any hair clumps in the outside kennels. Scoop behind the kennels and spray the area with Accel.'
				},
				{ id: 'sun-pm-a-help-spray', description: 'Help Staff B finish spraying Accel on the kennels' },
				{ id: 'sun-pm-a-slack', description: 'Slack update', tag: 'slack' }
			]
		},
		{
			staff: 'B',
			tasks: [
				{ id: 'sun-pm-b-dogs-out', description: 'Move all dogs to their outdoor kennels' },
				{ id: 'sun-pm-b-spot-clean', description: 'Spot clean indoor kennels. Refill waters, treats, and toys' },
				{ id: 'sun-pm-b-hang-gear', description: 'Hang all leashes, harnesses, collars, and vests to dry' },
				{ id: 'sun-pm-b-bring-in', description: 'Bring all dogs inside around 4:00', tag: 'movement' },
				{ id: 'sun-pm-b-scoop', description: 'Scoop poop' },
				{
					id: 'sun-pm-b-spray-water',
					description:
						'Spray all outdoor kennels with plain water if the outside temperature is above 40 F. Move igloos and beds to spray under and inside them. Clear ice and snow, if applicable'
				},
				{ id: 'sun-pm-b-spray-accel', description: 'Spray all outside kennels, beds, igloos, and walkways with Accel', tag: 'cleaning' },
				{ id: 'sun-pm-b-trash', description: 'Take out trash' },
				{ id: 'sun-pm-b-final-check', description: 'Final check on all dogs. Turn out the lights and lock the door.' },
				{ id: 'sun-pm-b-slack', description: 'Slack update', tag: 'slack' }
			]
		}
	]
};

const BATHROOM = 'Clean the staff bathroom- sweep/mop, scrub toilet, wipe down sink, shower, and mirror';
const HARNESSES = 'Fit all dogs with harnesses';

/** Weekly Tasks sheet, keyed by day of week (1 = Monday … 5 = Friday). Done by the afternoon shift or volunteers. */
export const WEEKLY_CHORES: Record<number, Record<StaffRole, string>> = {
	1: { A: HARNESSES, B: 'Empty and refill poop bag stations. Replace the bin liners' },
	2: { A: 'Sweep, mop, and declutter the meet and greet room', B: BATHROOM },
	3: { A: 'Disinfect any dog crates. Once dry, break them down and stack in the storage unit', B: 'Tighten/replace screws on all inside Kuranda beds' },
	4: { A: HARNESSES, B: 'Tighten/replace screws on all outside Kuranda beds' },
	5: { A: BATHROOM, B: 'Declutter the tops of the white kennels. Wipe down the tops with Accel.' }
};

/**
 * The sheet for a given day + shift. Sundays get the Sunday sheets. On the PM
 * sheet the "Weekly chores" line shows that day's chore for each staff, and is
 * dropped on days with none (Saturday).
 */
export function checklistFor(date: Date, shift: CleaningShift, forceSunday = false): ChecklistSheet {
	const day = date.getDay();
	if (forceSunday || day === 0) return shift === 'morning' ? sundayMorning : sundayEvening;
	if (shift === 'morning') return morning;
	const chores = WEEKLY_CHORES[day];
	return {
		...evening,
		sections: evening.sections.map((section) => ({
			...section,
			tasks: section.tasks.flatMap((task) => {
				if (!task.id.endsWith(WEEKLY_CHORES_ID)) return [task];
				return chores ? [{ ...task, detail: chores[section.staff] }] : [];
			})
		}))
	};
}

/** Task ids on today's sheet that count toward a dashboard tile; the first is the one the tile toggles. */
export function taggedTaskIds(sheet: ChecklistSheet, tag: ChecklistTag): string[] {
	return sheet.sections.flatMap((section) => section.tasks.filter((task) => task.tag === tag).map((task) => task.id));
}
