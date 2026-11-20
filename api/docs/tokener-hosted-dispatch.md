# Hosted providers funded by Tokener

The model in the App and the credential that pays for it are separate choices.
Core still obtains the original provider declaration, model schema and
parameter rules. The source plugin need not run the inference itself.

| Workspace and request | Model execution | Settlement |
| --- | --- | --- |
| Tokener profile, original provider's Dify-hosted credits | Daemon dispatch to the workspace's Tokener plugin | Tokener |
| No profile or NULL, original provider's hosted credits | Original provider plugin | Existing message credits |
| User-owned provider credentials (BYOK) | Original provider plugin | User's own provider account |

Enrollment is still limited to a new account's first self-owned workspace.
The async bootstrap installs the configured Tokener package and binds a
dedicated encrypted provider credential. It does not select a default model.
Use the existing `NEW_USER_DEFAULT_PLUGIN_IDS` and `NEW_USER_DEFAULT_MODELS`
to install and select a visible source provider at signup, or choose one in
the normal provider UI. Previously saved App/default model choices stay intact.

For a verified Marketplace source provider, the hosted catalog uses the
configured TRIAL/PAID model lists without creating or reading legacy credit
pools for Tokener profiles. The selected SYSTEM credentials are represented
by a private reference, not the vendor key. A CUSTOM selection cannot produce
this reference. The Core adapter rechecks the tenant's ready, encrypted
binding before asking the daemon to redirect. A missing integration, stale
package pin, or dispatch error fails without issuing a second inference or
falling back to legacy credits.

The daemon receives the ordinary dispatch data plus an authenticated,
tenant-scoped target descriptor at `dispatch/redirect/v1/{operation}`. The
data passed to the target has the same model parameters, messages, tools,
stop values and media as normal dispatch. Only routing identity and the
credential are substituted. Source credentials and transport-only fields
are not passed to the target. This is not a claim that Tokener interprets
every source parameter; that behavior belongs to its plugin and API.

## Rollout and verification

Deploy a compatible daemon before enabling new signup. Coordinate schema and
services according to the billing rollout: Core profile tables before Billing,
Billing bootstrap enabled only in the intended acceptance scope, no backfill.
Use a dedicated test tenant and staging Partner for agent dev; the test
Tokener package is built from a formal release with only its data-plane origin
and test version changed. Do not override another workspace's credentials or
change the published plugin. Do not use a custom payload adapter in the test.

Check registration and wallet provisioning, then create a test App with
the original Marketplace OpenAI provider in SYSTEM mode. Verify a normal
invocation and matching Tokener usage/debit with no old reservation, the
original App provider/model, and a legacy workspace still on its unchanged
credits path. Check the BYOK negative case separately.

Legacy migration is paused in this rollout, not coupled to new-user enrollment.
The earlier paid-cycle admission and one-time free enrollment designs are
recorded in Dify #41667 and Billing #160. Bringing their lifecycle forward
requires their own admission gate and a durable cutover fence: a profile
must only change after verified funding and readiness, and already-admitted
legacy reservations must retain their settlement owner. The active cohort
can then reuse this same invocation path. No existing profile is migrated
by this change; no old rollout PR needs to be merged for the new-user path.
