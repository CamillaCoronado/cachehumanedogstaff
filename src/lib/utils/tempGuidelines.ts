/**
 * The shelter's outdoor temperature rules, keyed off the current air temp.
 * Cold: below 40°F small dogs, puppies and just-fixed dogs come in; below 35°F everyone does.
 * Heat: the kennel chart's risk tiers, with the surface temps it lists for each.
 */
export type TempTone = 'cold' | 'caution' | 'high' | 'severe' | 'extreme';

export interface TempAdvisory {
	tone: TempTone;
	label: string;
	/** What staff should do. */
	protocol: string;
	/** Concrete / asphalt temps from the heat chart. */
	surfaces?: string;
}

export function tempAdvisory(tempF: number | null | undefined): TempAdvisory | null {
	if (tempF == null || !Number.isFinite(tempF)) return null;
	if (tempF < 35) {
		return { tone: 'cold', label: 'Bring everyone inside', protocol: 'Below 35°F: all dogs come inside.' };
	}
	if (tempF < 40) {
		return {
			tone: 'cold',
			label: 'Bring small dogs inside',
			protocol: 'Below 40°F: small dogs, puppies and dogs that just got fixed come inside. Everyone else at 35°F.'
		};
	}
	if (tempF >= 95) {
		return {
			tone: 'extreme',
			label: 'Extreme hazard',
			protocol: 'Immediate burn & heatstroke emergency. Outdoor time restricted strictly to brief potty breaks.',
			surfaces: 'Concrete 130–140°F+ · asphalt 145°F+'
		};
	}
	if (tempF >= 90) {
		return {
			tone: 'severe',
			label: 'Severe danger',
			protocol: 'Severe paw & belly burns rapidly. NO laying on unshaded cement. Indoor rotation required.',
			surfaces: 'Concrete 120–130°F · asphalt 140°F'
		};
	}
	if (tempF >= 85) {
		return {
			tone: 'high',
			label: 'High risk',
			protocol: 'Burns occur in < 60 seconds. Keep dogs off unshaded cement; move to grass or shade.',
			surfaces: 'Concrete 115–120°F · asphalt 130°F'
		};
	}
	if (tempF >= 80) {
		return {
			tone: 'caution',
			label: 'Moderate caution',
			protocol: 'Paw burns possible with sustained contact. Limit cement exposure; utilize shaded runs.',
			surfaces: 'Concrete 110–115°F · asphalt 125°F'
		};
	}
	// 40–79°F: standard turnout, nothing to flag.
	return null;
}
