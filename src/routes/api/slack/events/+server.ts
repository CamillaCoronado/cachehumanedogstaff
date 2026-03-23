import { json, error, text } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { createHmac, timingSafeEqual } from 'crypto';
import { parsePlaygroupMessage } from '$lib/utils/parsePlaygroupMessage';
import { getAdminDb } from '$lib/firebase/admin';

const MAX_TIMESTAMP_SKEW_MS = 5 * 60 * 1000; // 5 minutes

function verifySlackSignature(
	signingSecret: string,
	rawBody: string,
	timestamp: string,
	signature: string
): boolean {
	// Reject stale requests
	const ts = Number(timestamp) * 1000;
	if (Math.abs(Date.now() - ts) > MAX_TIMESTAMP_SKEW_MS) return false;

	const basestring = `v0:${timestamp}:${rawBody}`;
	const expected = `v0=${createHmac('sha256', signingSecret).update(basestring).digest('hex')}`;

	try {
		return timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(signature, 'utf8'));
	} catch {
		return false;
	}
}

export async function POST({ request }) {
	const rawBody = await request.text();

	const { SLACK_SIGNING_SECRET, SLACK_PLAYGROUPS_CHANNEL_ID } = env;

	// If not configured, reject clearly
	if (!SLACK_SIGNING_SECRET) {
		throw error(503, 'Slack signing secret not configured');
	}

	// Verify signature
	const timestamp = request.headers.get('x-slack-request-timestamp') ?? '';
	const signature = request.headers.get('x-slack-signature') ?? '';
	if (!verifySlackSignature(SLACK_SIGNING_SECRET, rawBody, timestamp, signature)) {
		throw error(401, 'Invalid Slack signature');
	}

	let body: Record<string, unknown>;
	try {
		body = JSON.parse(rawBody);
	} catch {
		throw error(400, 'Invalid JSON');
	}

	// URL verification challenge (one-time during Slack app setup)
	if (body.type === 'url_verification') {
		return text(String(body.challenge));
	}

	if (body.type !== 'event_callback') {
		return json({ ok: true });
	}

	const event = body.event as Record<string, unknown> | undefined;
	if (!event) return json({ ok: true });

	// Only handle plain user messages from the playgroups channel
	if (
		event.type !== 'message' ||
		event.subtype !== undefined || // skip edits, bot posts, etc.
		event.bot_id !== undefined ||
		(SLACK_PLAYGROUPS_CHANNEL_ID && event.channel !== SLACK_PLAYGROUPS_CHANNEL_ID)
	) {
		return json({ ok: true });
	}

	const rawText = String(event.text ?? '').trim();
	if (!rawText) return json({ ok: true });

	const parsed = parsePlaygroupMessage(rawText);

	// Only queue if we parsed at least one dog name
	if (parsed.dogNames.length === 0) return json({ ok: true });

	try {
		const adminDb = getAdminDb();
		await adminDb.collection('pendingPlaygroups').add({
			rawText,
			dogNames: parsed.dogNames,
			suggestedNotes: parsed.notes,
			suggestedOutcome: parsed.outcome,
			slackTs: String(event.ts ?? ''),
			receivedAt: new Date().toISOString(),
			processed: false
		});
	} catch (e) {
		// Log but don't fail — Slack requires 200 within 3 s or it will retry
		console.error('[Slack webhook] Firestore write failed:', e);
	}

	return json({ ok: true });
}
