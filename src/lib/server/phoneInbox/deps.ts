import type { Firestore } from 'firebase-admin/firestore';
import type { PipelineDeps } from './pipeline';
import type { PendingProposal } from './types';
import { applyActions, queueForReview } from './apply';
import { parseInboundText } from './parse';

// Real Firestore/OpenAI implementations of the pipeline dependencies. The
// pending-proposal state lives in phonePending/{phone} (one per sender —
// a new message naturally replaces the old proposal).

export function createFirestoreDeps(db: Firestore): PipelineDeps {
	return {
		async findStaffByPhone(phone) {
			const snapshot = await db.collection('users').where('phoneNumber', '==', phone).limit(1).get();
			if (snapshot.empty) return null;
			const data = snapshot.docs[0].data();
			return { uid: (data.uid as string) ?? snapshot.docs[0].id, displayName: (data.displayName as string) || (data.email as string) || 'Staff' };
		},

		async fetchRoster() {
			// Active, in-shelter dogs only — the phone line is for daily operations.
			const snapshot = await db.collection('dogs').where('status', '==', 'active').select('name').get();
			return snapshot.docs.map((d) => ({ id: d.id, name: (d.data().name as string) ?? '' })).filter((d) => d.name);
		},

		parse: (text, dogNames) => parseInboundText(text, dogNames),

		async getPending(phone) {
			const snap = await db.collection('phonePending').doc(phone).get();
			return snap.exists ? (snap.data() as PendingProposal) : null;
		},

		async savePending(proposal) {
			await db.collection('phonePending').doc(proposal.phone).set(proposal);
		},

		async clearPending(phone) {
			await db.collection('phonePending').doc(phone).delete();
		},

		applyActions: (actions, staff) => applyActions(db, actions, staff, new Date()),

		queueForReview: (message, staff, reason) =>
			queueForReview(db, { from: message.from, channel: message.channel, text: message.text }, staff, reason, new Date()),

		now: () => new Date()
	};
}
