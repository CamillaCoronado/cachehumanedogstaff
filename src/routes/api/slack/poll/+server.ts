import { json, error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { pollSlackFeedings } from '$lib/server/slackFeedingPoll';
import { pollSlackPlaygroups } from '$lib/server/slackPlaygroupPoll';

/**
 * Daily safety net. The queue is kept current by the ASM sync every user triggers on
 * load; this catches a stretch where nobody opened the app. Hobby plans allow only one
 * cron run per day, which is why the frequent path lives on the sync instead.
 */
export async function GET({ request }: RequestEvent) {
	const { CRON_SECRET } = env;
	// Without a secret configured the route stays closed rather than open — it queues
	// data, so it should not be callable by anyone who finds the URL.
	if (!CRON_SECRET) throw error(503, 'CRON_SECRET not configured');
	if (request.headers.get('authorization') !== `Bearer ${CRON_SECRET}`) throw error(401, 'Unauthorized');

	const feedings = await pollSlackFeedings();
	// Its own failure must not lose the feeding result, and the reverse.
	const playgroups = await pollSlackPlaygroups().catch((e) => ({ error: String(e) }));
	return json({ polled: true, ...feedings, playgroups });
}
