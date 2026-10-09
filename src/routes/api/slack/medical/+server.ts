import { json, error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { getAdminAuth, getAdminDb } from '$lib/firebase/admin';
import { applyMedicalActions, medicalRoster, PENDING_MEDICAL, type PendingMedical } from '$lib/server/slackMedicalPoll';
import { resolveMedicalActions } from '$lib/utils/medicalSlack';

/**
 * #medical-updates posts the poll held back, for an admin's Slack list. Read and applied
 * here, with admin credentials, so the queue needs no Firestore rules of its own.
 */
async function requireAdmin(request: Request) {
	const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
	if (!token) throw error(401, 'Missing auth token');
	let uid: string;
	try {
		uid = (await getAdminAuth().verifyIdToken(token)).uid;
	} catch {
		throw error(401, 'Invalid auth token');
	}
	const profile = await getAdminDb().collection('users').doc(uid).get();
	if (profile.data()?.role !== 'admin') throw error(403, 'Admins only');
}

export async function GET({ request }: RequestEvent) {
	await requireAdmin(request);
	const snap = await getAdminDb().collection(PENDING_MEDICAL).where('processed', '==', false).get();
	const pending = snap.docs
		.map((d) => ({ id: d.id, ...(d.data() as Omit<PendingMedical, 'id'>) }))
		.sort((a, b) => (a.postedAt < b.postedAt ? 1 : -1));
	return json({ pending });
}

/**
 * `apply` writes the post's actions; `assign` names the dog for each name the app
 * couldn't match (a name left out is skipped). `dismiss` drops the post.
 */
export async function POST({ request }: RequestEvent) {
	await requireAdmin(request);
	const body = (await request.json().catch(() => ({}))) as { id?: string; action?: string; assign?: Record<string, string> };
	if (!body.id) throw error(400, 'Missing id');

	const db = getAdminDb();
	const ref = db.collection(PENDING_MEDICAL).doc(body.id);
	const snap = await ref.get();
	if (!snap.exists) throw error(404, 'Not found');
	const pending = snap.data() as Omit<PendingMedical, 'id'>;

	if (body.action === 'dismiss') {
		await ref.set({ processed: true, outcome: 'dismissed' }, { merge: true });
		return json({ ok: true, changed: 0 });
	}
	if (body.action !== 'apply') throw error(400, 'Unknown action');

	const { roster, groups } = await medicalRoster(db);
	const { actions, unmatched } = resolveMedicalActions(pending.actions ?? [], roster, groups);
	const assign = body.assign ?? {};
	for (const raw of pending.actions ?? []) {
		if (!unmatched.includes(raw.dogName)) continue;
		const dog = roster.find((d) => d.id === assign[raw.dogName]);
		if (dog) actions.push({ ...raw, dogId: dog.id, dogName: dog.name });
	}
	const changed = await applyMedicalActions(db, actions, new Date(pending.postedAt), pending.author, pending.slackTs);
	await ref.set({ processed: true, outcome: 'applied' }, { merge: true });
	return json({ ok: true, changed });
}
