# Security Hardening Notes

## What Changed

- Self-service profile creation is now staff-only.
- Only admins can create, update, or delete user profiles.
- Local fallback role default changed from manager to staff.

## Files

- `firestore.rules`
- `src/lib/stores/auth.ts`
- `src/lib/stores/role.ts`

## Operational Impact

- A brand-new user can no longer grant themselves admin/manager by writing their own profile.
- Manager users can no longer modify user accounts directly in Firestore.
- In local-role fallback mode, the UI defaults to least-privileged behavior.

## Admin Bootstrap

If your project has no admin profile yet:

1. Create a user profile document in Firestore for a trusted account.
2. Set `role` to `admin`.
3. Sign in with that account and manage other roles from there.

