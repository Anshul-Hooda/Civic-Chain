# CITYFILE — Full Application Audit

Audit date: 18 Sep 2026

This audit treats CITYFILE as one application rather than separate frontend/backend snippets. The review covered the supplied current `index.html`, `style.css`, `script.js`, `main.py`, `models.py`, the supplied/past `schemas.py`, and the `database.py` / `blockchain.py` code supplied in the same message. It also checked the contracts between the browser, FastAPI routes, SQLAlchemy models, Clerk authentication, local file uploads, and the local SHA-256 integrity chain.

## What I changed in this patch

| Area | Change | Why | Risk level |
|---|---|---|---|
| Citykeepers HTML | Restored the original `.citykeeper-profile-stage` + `.citykeeper-seal-column` hierarchy while retaining the clickable Clerk sign-in seal | The current markup no longer matched the stylesheet's intended layout, which caused the very sparse/broken Citykeepers composition | Low; structural UI repair only |
| Citykeepers CSS | Removed the recent emergency `CLEAN SIGNED OUT LAYOUT` override block | It overrode the original design system and was the main source of the stretched/sparse layout | Low; restores pre-existing rules |
| Map navigation | Added the missing `openMapFor()` function | The function was called from multiple places but did not exist; marker/explorer clicks could throw `ReferenceError` | Low; fills a missing integration function |
| Multi-city reporting | Filtered the department dropdown to the selected city | The backend validates department-city ownership, but the frontend previously showed every department | Low; makes frontend match backend validation |
| Reference seed data | Ensured the standard departments exist for Delhi, Sonipat and Gurugram | Previously only Delhi received seeded departments, so reports for the other seeded cities could fail | Low; additive seeding only, no destructive DB rewrite |
| Citykeeper eligibility | Added `citykeeper_eligible` to complaint serialization and made the frontend prefer it | Prevents frontend and backend from disagreeing about whether a complaint is safe for community action | Low; backend is now source of truth |
| Complaint refresh | Reused evidence already included in `/complaints` and reduced unnecessary per-record requests | The previous refresh produced a large request fan-out every 60 seconds | Low; same data source, fewer requests |
| Clerk keyboard access | Enter/Space now activates the custom sign-in seal | The seal is a `div` with `role="button"`; click worked but keyboard activation did not | Low |
| Environment loading | `.env` is loaded before database/blockchain imports | `DATABASE_PATH` and `BLOCKCHAIN_PATH` were read at import time before `.env` was loaded | Low; fixes configuration ordering |
| Path handling | Resolved DB, blockchain, assets, uploads, HTML/CSS/JS paths from the project directory | Starting Uvicorn from a different working directory could otherwise break files or create data in the wrong place | Low |
| SQL logging | SQLAlchemy `echo` is now controlled by `SQL_ECHO` and defaults to false | `echo=True` can expose private reporter fields in logs and makes production logs noisy | Low |
| Home marker wording | Decorative category markers now say `VIEW RECORDS` instead of hard-coded statuses | A decorative marker should not contradict live backend status | Low |
| Test connection text | Corrected the message from “MySQL” to “SQLite” | The project actually uses SQLite | No runtime effect |

## Confirmed working at the code-contract level

The following properties were checked after the patch:

| Check | Result |
|---|---|
| Python syntax for `main.py`, `models.py`, `database.py`, `blockchain.py`, `schemas.py`, `testconnection.py` | PASS |
| JavaScript syntax (`node --check`) | PASS |
| Duplicate HTML IDs | PASS — none found |
| Every `data-view` navigation target has a matching `data-view-name` view | PASS |
| `citykeeperYourMark` stays inside `citykeepersView` | PASS |
| `citykeeperHallOfFame` stays inside `citykeepersView` | PASS |
| FastAPI app imports while launched from a different working directory | PASS in isolated smoke test |
| `/config`, `/cities`, `/categories`, `/departments`, `/complaints`, `/blockchain` | PASS in isolated smoke test |
| Sonipat has valid departments after fresh database initialization | PASS |
| Gurugram has valid departments after fresh database initialization | PASS |
| Cross-city department submission is rejected by backend | PASS |
| Private reporter fields are absent from public complaint response | PASS |
| Backend emits `citykeeper_eligible` | PASS |
| Current frontend `fetchJSON()` routes have corresponding FastAPI endpoints | PASS at route-contract level |

The smoke test used a temporary SQLite database and temporary integrity-chain file; it did not touch the supplied real database.

## Problems still worth addressing before calling this production-ready

These are deliberately **not automatically rewritten in this patch** because each would change storage, security policy, data migration, or user-facing workflow and therefore carries a higher chance of breaking an otherwise working hackathon build.

| Severity | Area | Risk | Recommended action |
|---|---|---|---|
| CRITICAL for Railway persistence | SQLite / uploads / blockchain JSON | If Railway is running without a persistent volume, complaints, uploaded images, and the hash chain can disappear after redeploy/restart | Use a Railway persistent volume and point `DATABASE_PATH`, `UPLOADS_PATH`, and `BLOCKCHAIN_PATH` into it. Keep one app replica/worker while using this local-storage architecture |
| HIGH | Multiple workers/replicas | `threading.RLock` only protects the hash-chain file inside one Python process; multiple workers can race on `blockchain.json`, SQLite, and local uploads | Use a single worker/replica for the hackathon. For real scaling, move DB/object storage/integrity events to shared transactional infrastructure |
| HIGH | DB + integrity chain transaction boundary | The DB can commit successfully and the later hash-chain append can fail, leaving a valid DB record without an integrity anchor | For a production design, persist integrity events transactionally in the DB/outbox, then anchor asynchronously; do not silently claim a blockchain write |
| HIGH | Complaint + initial photo atomicity | Complaint creation and image upload are separate requests. A failed upload leaves a complaint without its “required” initial image | Either accept/document this recoverable state, add retry UI, or later create an atomic multipart complaint endpoint |
| HIGH | Public upload abuse | Public evidence upload accepts anonymous non-privileged evidence and there is no rate limiting | Add rate limiting, size/count quotas, abuse controls, and eventually malware/image validation |
| HIGH | Deployment secrets/config | `.env`, Clerk secret, DB files and uploads must not be committed accidentally | Ensure `.env` is in `.gitignore`; use Railway variables for secrets; never put `CLERK_SECRET_KEY` in frontend files |
| MEDIUM | Existing DB migrations | `create_all()` creates missing tables but does not evolve existing table columns. Only `users.clerk_user_id` has a manual compatibility migration | Adopt Alembic before making further schema changes. Back up `civic_complaints.db` before migrations |
| MEDIUM | Citykeeper uniqueness under concurrency | Participation and verification duplication is mostly prevented in application code, but some invariants are not backed by DB unique constraints | Add DB constraints with a migration when moving beyond a single-worker prototype |
| MEDIUM | Authority vs Citykeeper verifier role | Authority accounts are blocked from authority-resolution citizen verification, but are not inherently blocked from verifying another person's Citykeeper evidence | Decide policy explicitly. If “citizen” must exclude authority accounts everywhere, enforce it server-side |
| MEDIUM | Image privacy | Uploaded images are stored as supplied; EXIF metadata is not stripped server-side | Re-encode/strip metadata server-side before public storage if privacy is important |
| MEDIUM | Anonymous complaint ownership | `/me/complaints` is Clerk-user based. Reports created anonymously before sign-in are not automatically attached to a later Clerk account | Keep as documented behavior, or design a secure claim/link flow later |
| MEDIUM | Refresh while editing | The application refreshes complaint data every 60 seconds. A rerender can interfere with an in-progress dynamically rendered Citykeeper work form | Suspend/reduce rerendering while a work form has unsaved input, or preserve form state before rerender |
| LOW/MEDIUM | Static dependencies | Leaflet, Google Fonts and Clerk JS are external dependencies; network/content-blocking failures can degrade parts of UI | Have clear fallback messaging and test on the event network/browser |
| LOW | Multi-city branding | The home hero says `DELHI · LIVE` while the backend currently supports Delhi, Sonipat and Gurugram | Decide whether CITYFILE is deliberately Delhi-branded or truly multi-city, then make the wording consistent |
| LOW | `CITY_CENTERS` | Frontend includes Rohtak but the backend seed set does not | Remove Rohtak or add it intentionally; it is currently harmless because no seeded Rohtak record exists |

## Important architecture facts to keep consistent in the presentation

CITYFILE's integrity layer is a **local file-backed SHA-256 tamper-evident chain**, not a public blockchain transaction or smart contract. The code correctly says this now. Do not claim that the current prototype writes to Ethereum/Polygon or that the hash chain proves a real-world repair happened.

Authority proof and Citykeeper proof are separate workflows. Authority can submit a resolution attempt, but final complaint closure is controlled by a signed-in non-authority citizen review. Citykeepers is the separate community-safe-action loop in which one contributor acts and another user verifies the community evidence.

## Required local/deployment configuration

At minimum, your environment should provide Clerk keys and, for deployment, explicit persistence paths. A typical configuration is:

```env
CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
CLERK_AUTHORITY_USER_IDS=user_...
CLERK_AUTHORIZED_PARTIES=http://127.0.0.1:3000,http://localhost:3000

# On Railway, point these at the mounted persistent volume.
DATABASE_PATH=./civic_complaints.db
UPLOADS_PATH=./uploads
BLOCKCHAIN_PATH=./blockchain.json

SQL_ECHO=false
```

Do not put the secret key in `index.html` or `script.js`.

## Assets expected by the current frontend

The existing project must still contain these assets; they are not included in this patch archive:

```text
assets/city_street.png
assets/all.jpg
assets/pothole.jpg
assets/garbage.jpg
assets/water.jpg
assets/drainage.jpg
assets/streetlight.jpg
assets/safety.jpg
assets/other.jpg
```

## Minimum Python dependency checklist

I did not overwrite your `requirements.txt` because it was not included in the supplied project snapshot. Verify that it includes the packages your current code imports, especially FastAPI/Uvicorn, SQLAlchemy, Pydantic, `python-multipart`, `python-dotenv`, and `clerk-backend-api`.

## Pre-demo end-to-end test matrix

Run this against the actual local/Railway build after copying the patch, because static checks cannot prove external Clerk, browser geolocation, persistent-volume configuration, or uploaded media behavior.

| Flow | Expected result |
|---|---|
| Fresh page load | No console syntax errors; CITY view only; no Citykeepers/Hall of Fame leaking below it |
| Home category marker | Opens Map with the matching filter; no `openMapFor` ReferenceError |
| Report: Delhi | Only Delhi departments shown; complaint creates; image attaches; record appears in archive/track |
| Report: Sonipat | Sonipat departments shown; submission succeeds instead of city/department mismatch |
| Report: Gurugram | Gurugram departments shown; submission succeeds |
| Refresh/restart | Existing complaint and uploaded image remain available |
| Clerk citizen sign-in | `/auth/me` succeeds and stable `CK-...` ID appears |
| Your Files | Shows only complaints owned by the signed-in Clerk user |
| Citizen tries Authority action | Backend returns 403 / UI does not record action |
| Authorized authority account | Can acknowledge, move to In Progress, set deadline, submit after-photo + geotag |
| Authority submits fix | Complaint becomes `Awaiting Verification`, not `Verified` |
| Same authority tries final citizen review | Blocked |
| Citizen verifies authority proof | Complaint becomes `Verified`; refresh/server restart preserves it |
| Citizen questions/reopens | Complaint becomes `Disputed`; previous proof remains visible; authority can submit a new attempt |
| Citykeeper A joins safe mission | Participation persists and profile count updates |
| Citykeeper A uploads after evidence | Evidence persists; cannot self-verify |
| Citykeeper B verifies A's evidence | Verified community impact/profile/Hall of Fame update |
| Infrastructure complaint in Citykeepers | Does not appear as community-safe mission / backend rejects community action |
| Integrity page | Local chain verifies and is described as local tamper-evident integrity, not public Web3 |
| Railway redeploy | DB, uploads and `blockchain.json` survive only if persistent storage is correctly mounted/configured |

## Patch philosophy

The patch intentionally does **not** replace your database architecture, change complaint IDs, rewrite your authority/citizen state machine, merge Citykeepers into authority verification, delete old records, invent demo data, or redesign the rest of your UI. The changes are targeted at confirmed wiring, consistency, path/configuration, and layout defects.
