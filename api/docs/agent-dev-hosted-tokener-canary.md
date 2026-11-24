# Agent dev only: hosted signup canary

This overlay lets one newly registered agent-dev workspace test the shared
model-dispatch transport with a signed, isolated staging package. Do not
promote it to main. It changes neither Alembic history nor legacy fixture
binding, plan, or route state.

Set these values consistently on the agent-dev API and signup worker:

- `TOKENER_NEW_TENANT_COHORT_ENABLED=true` and `TOKENER_NEW_TENANT_BOOTSTRAP_ENABLED=true`
- `TOKENER_SIGNUP_VALIDATION_EMAIL` to the exact new test signup email, not an existing account
- `TOKENER_SIGNUP_VALIDATION_PLUGIN_UNIQUE_IDENTIFIER` to the verified signed staging Marketplace package UID
- `TOKENER_SIGNUP_VALIDATION_BILLING_API_URL=http://tokener-hosted-billing-candidate:8081`
- `TOKENER_LEGACY_MIGRATION_ENABLED=false` on Core, and `TOKENER_MIGRATION_ENABLED=false` on Billing roles to stop new old-tenant migration admission during the test

Keep the working baseline Tokener settings in place. The alternate SKU is
selected only when signup persists its distinct staging package pin. The
matching workspace uses the private candidate for bootstrap and metering.
It does not fall back to shared Billing if the private candidate is removed.

The standard default-plugin task installs the verified source OpenAI Marketplace
plugin for the canary only. Select its Credits option. The retained model identity
should be `langgenius/openai/openai`
and the same request should debit only the canary's staging org. The
existing BYOK and legacy paths must not pick up the canary.

## Shared staging Billing (agent dev)

To use the existing shared agent-dev Billing service for **all future
self-signups**, configure these values consistently in the API and signup
worker:

- `TOKENER_SIGNUP_VALIDATION_BILLING_API_URL=http://dify-saas-billing:8081`
- `TOKENER_BILLING_API_URL=http://dify-saas-billing:8081`
- `TOKENER_SIGNUP_VALIDATION_PLUGIN_UNIQUE_IDENTIFIER` to the exact verified
  signed `langgenius/tokener-staging:<version>@<sha256>` Marketplace UID.

Both new ordinary signups and prior staging intents use the explicit shared
route for Tokener bootstrap and metering, without redirects. In this mode the
old exact-email selector is ignored. The package pin is signup-only; do not
replace the global Tokener plugin, provider, endpoint or legacy settings. The
shared server selects its staging Partner only for consumed staging intents;
old non-staging intents retain the original Partner. Signup package signature
checks and persisted identity are unchanged.

Before enabling this mode, verify the shared Billing instance actually uses
the approved Tokener staging partner and base for native bootstrap/metering.
Keep unrelated Billing routes and all migration and Stripe behavior outside
this cutover.

## Runtime backport

This branch replays the signup-intent prerequisites and hosted canary over
agent dev's existing runtime source revision. It requires the already deployed
signup-intent schema; it neither contains nor runs a migration. Construct the
candidate from the current runtime image and replace only the verified Python
path list. The existing hosting moderation modules, unrelated runtime files,
image defaults and shared Compose files are not part of this overlay.

Before replacing a role, confirm every touched path matches the expected
baseline (including paths expected to be absent), and verify all other
production Python files are unchanged in the candidate. Check the worker and
daemon capabilities separately; do not infer them from the API image. Until
the exact-email signup succeeds, the previous API image is the rollback; after
a staging intent is consumed, retain its routing and private Billing ownership.
