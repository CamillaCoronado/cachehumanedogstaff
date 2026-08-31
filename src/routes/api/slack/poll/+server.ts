import { json, error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { pollSlackFeedings } from '$lib/server/slackFeedingPoll';

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

	return json({ polled: true, ...(await pollSlackFeedings()) });
}
