# Plan 3 Design: Production Deploy + Pre-Deploy Fixes

Date: 2026-07-27
Status: approved (brainstormed with owner; decisions recorded below)

## Goal

Deploy TripSplit to production: backend (Cloud Functions v2 + Firestore + Storage) on the existing Firebase project `sfayw-10d11`, frontend (static SPA) on Vercel. Success criterion: **the full golden path passes on the real URL, including real-Gemini-key receipt auto-classification** — superadmin creates a trip, admin sets it up and adds members, a member logs in and submits a photo-first expense, admin confirms it and views the receipt, the report renders.

## Decisions (owner-confirmed)

| Decision | Choice |
|---|---|
| Scope | Deploy + must-fix data-model changes only. Old-data migration → Plan 4. UX/error-map/a11y pass → Plan 5. |
| Backend platform | Keep Firebase Cloud Functions; owner upgrades `sfayw-10d11` Spark → Blaze (with a $1 budget alert). |
| Frontend hosting | Vercel (owner's existing account), default `*.vercel.app` domain. No custom domain. |
| Region | Move from `us-central1` to `asia-northeast3` (Seoul) before first deploy. |
| Gemini API key | Owner already has one. Secrets are entered by the owner via `firebase functions:secrets:set` — secret values never pass through Claude. |

## Part 1: Pre-deploy code changes

These land (with tests, via the normal SDD flow) BEFORE anything real is deployed, because they change the stored data shape — doing them now means no data migration ever.

### 1a. Receipt photo lifecycle

Problem today: `classifyReceipt` uploads the image, then stores a **7-day signed URL** on the expense document — every receipt link dies after a week; a Gemini failure throws away the uploaded object entirely (`receipts.js:21-22` uploads before classifying but the whole call rejects); and no view ever renders the photo, so the admin confirming an expense cannot see the receipt at all.

Changes:

- **`storage.js`**: `uploadReceiptImage` returns the storage **path** (`receipts/<tripId>/<32-hex>.<ext>`), not a signed URL. Signed-URL minting moves to a new `getReceiptReadUrl(bucket, path, ttlMs)` helper (15-minute TTL).
- **Expense documents**: field renames `photoUrl` → `photoPath` across `addExpense`/`updateExpense`/`listExpenses` and both frontend entry flows (`member.js`, `admin.js`). No production data exists yet, so this is a clean rename, no migration.
- **`classifyReceipt` partial-failure contract**: upload first, then classify inside try/catch. On classification failure return `{ photoPath, classified: false }` instead of throwing, so the photo stays attached when the user falls back to manual entry. On success return `{ photoPath, classified: true, category, date, amount, merchant, detail }`. Frontend keeps its "자동 인식 실패 — 직접 입력해주세요" toast, keyed on `classified === false`, and keeps `photoPath` either way. (Upload failure still throws — nothing to keep.)
- **New callable `getReceiptUrl`**: input `{ tripId, expenseId }`; `requireSession(db, token, ['admin', 'member'], tripId)`; loads the expense, verifies it belongs to `tripId` and has a `photoPath`; returns `{ url }` — a 15-minute signed URL minted at read time. Errors: `EXPENSE_NOT_FOUND`, `NO_PHOTO`.
- **Admin 경비확인 tab**: each expense row with a `photoPath` gets a **영수증 보기** button → calls `getReceiptUrl` → shows the image in the existing modal (`openModal`). Member view stays list-only (unchanged scope).
- **`deleteExpense`**: when the expense has a `photoPath`, best-effort delete the storage object (`bucket.file(path).delete()` wrapped so a storage failure never blocks the Firestore delete).

### 1b. Session TTL

`sessions` docs store `expiresAt` as epoch-ms (kept — it is the API contract with the frontend). Add a sibling **Firestore `Timestamp` field `ttlAt`** (same instant) at session creation, because Firestore TTL policies only accept Timestamp fields. The TTL policy itself on `sessions.ttlAt` is a runbook step (Part 2). `loginAttempts` docs are bounded (a handful per trip) — no TTL, unchanged.

### 1c. Seoul region

- `functions/index.js`: `setGlobalOptions({ region: 'asia-northeast3' })`.
- `public/api.js`: `REGION = 'asia-northeast3'`; local emulator URL keeps the same region string (the emulator serves whatever region the code declares).
- Update any test assertions that embed the region string (`public/test/api.test.js`).

### 1d. Production configuration

- `public/api.js`: `PROD_PROJECT_ID = 'sfayw-10d11'`; remove the Plan-3 placeholder NOTE.
- `functions/index.js`: replace the hardcoded `demo-sfayw.appspot.com` bucket with an environment split — under the emulator (`process.env.FUNCTIONS_EMULATOR`) keep the explicit demo bucket; in production call `admin.initializeApp()` bare so the default bucket resolves from the project. Verify the resolved production bucket name during deploy (new default buckets are `<project>.firebasestorage.app`).
- `.firebaserc`: add `prod: "sfayw-10d11"` alias alongside the `demo-sfayw` default (emulator workflow unchanged).
- **New `vercel.json`** at repo root: no build step, output directory `public/`, rewrite `/(.*)` → `/index.html` (SPA). The repo's Node tooling (test devDependencies) must not trigger a framework build on Vercel.

## Part 2: Deploy runbook

Owner-action steps are the ones Claude cannot and must not do (billing, OAuth, secret values). Everything else is Claude's.

1. **Owner**: Firebase console → upgrade `sfayw-10d11` to Blaze; set a $1/month budget alert.
2. **Owner**: `npx firebase-tools@14 login` (browser OAuth).
3. **Claude**: verify Firestore + default Storage bucket exist on the project (enable via console/CLI as needed — bucket provisioning may require a console click; if so, hand that single click back to the owner); deploy `firestore.rules` + `storage.rules`.
4. **Owner**: set the two secrets — `firebase functions:secrets:set SUPERADMIN_PASSWORD_HASH` (Claude provides a tiny local script that bcrypt-hashes a password of the owner's choosing so only the hash is entered) and `firebase functions:secrets:set GEMINI_API_KEY`. Values never pass through Claude.
5. **Claude**: `firebase deploy --only functions`; grant the functions runtime service account `roles/iam.serviceAccountTokenCreator` on itself (required for `getSignedUrl` signBlob in production); create the Firestore TTL policy on `sessions.ttlAt` (gcloud or console; if console-only, hand back to owner with exact clicks).
6. **Owner**: authorize the Vercel connection for project creation (existing account).
7. **Claude**: create/link the Vercel project (name `tripsplit`), production deploy, then run the full golden-path smoke test on the real URL — including a real receipt photo through Gemini classification and the admin 영수증 보기 flow.

Rollback stance: functions are versionless callables — a bad deploy is fixed by redeploying the previous commit; Vercel keeps previous deployments one click away. No data rollback concerns (fresh project).

## Part 3: Testing

- Unit (all existing 240 tests stay green; new tests follow the same fake-Firestore/fake-bucket pattern): `uploadReceiptImage` returns a path; `getReceiptReadUrl` mints from a path; `classifyReceipt` returns `classified:false` + `photoPath` when Gemini throws but still throws when upload fails or payload invalid; `getReceiptUrl` authorization (wrong trip, missing expense, no photo) and happy path; `deleteExpense` deletes the object best-effort (storage error does not block); `createSession` writes `ttlAt` Timestamp equal to `expiresAt`.
- Emulator E2E: rerun the Task-13 golden path locally (now also exercising 영수증 보기).
- Production smoke test: the success criterion at the top, on the real URL.

## Out of scope (deferred)

- travel_report.html / RTDB `accounts`·`paid` migration → Plan 4.
- Korean error-message map, per-view load-failure handling, submit in-flight states, modal a11y → Plan 5.
- Custom domain, IP-scoped login throttling, client-side image downscaling, `public/constants.js` category dedup — recorded in the SDD ledger follow-up list; none block production.
