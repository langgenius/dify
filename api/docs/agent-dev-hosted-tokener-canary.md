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
