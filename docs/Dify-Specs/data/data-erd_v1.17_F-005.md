---
title: Data Model v1.17 F-005 — Workspace, Identity and Access
id: F-005
status: draft
owner: TBD
updated: 2026-09-20
---

# Data Model v1.17 F-005 — Workspace, Identity and Access

> The slice of the data model this feature owns, at field precision. Generated from the ORM.

## Scope

35 entities, 327 columns [D: api/models/].

| Entity | Own / read / write | Source |
| --- | --- | --- |
| `account_integrates` | own | `api/models/account.py:320` |
| `account_plugin_permissions` | own | `api/models/account.py:385` |
| `account_step_by_step_tour_states` | own | `api/models/onboarding.py:13` |
| `accounts` | own | `api/models/account.py:89` |
| `api_based_extensions` | own | `api/models/api_based_extension.py:20` |
| `api_tokens` | own | `api/models/model.py:2254` |
| `credential_permissions` | own | `api/models/credential_permission.py:22` |
| `invitation_codes` | own | `api/models/account.py:348` |
| `load_balancing_model_configs` | own | `api/models/provider.py:274` |
| `oauth_access_tokens` | own | `api/models/oauth.py:97` |
| `oauth_provider_apps` | own | `api/models/model.py:1074` |
| `provider_credentials` | own | `api/models/provider.py:307` |
| `provider_model_credentials` | own | `api/models/provider.py:340` |
| `provider_model_settings` | own | `api/models/provider.py:244` |
| `provider_models` | own | `api/models/provider.py:118` |
| `provider_orders` | own | `api/models/provider.py:211` |
| `providers` | own | `api/models/provider.py:34` |
| `rate_limit_logs` | own | `api/models/dataset.py:1346` |
| `tenant_account_joins` | own | `api/models/account.py:292` |
| `tenant_default_models` | own | `api/models/provider.py:167` |
| `tenant_plugin_auto_upgrade_strategies` | own | `api/models/account.py:431` |
| `tenant_preferred_model_providers` | own | `api/models/provider.py:190` |
| `tenants` | own | `api/models/account.py:253` |
| `tool_api_providers` | own | `api/models/tools.py:134` |
| `tool_builtin_providers` | own | `api/models/tools.py:73` |
| `tool_conversation_variables` | own | `api/models/tools.py:440` |
| `tool_files` | own | `api/models/tools.py:481` |
| `tool_label_bindings` | own | `api/models/tools.py:208` |
| `tool_mcp_providers` | own | `api/models/tools.py:294` |
| `tool_model_invokes` | own | `api/models/tools.py:390` |
| `tool_oauth_system_clients` | own | `api/models/tools.py:33` |
| `tool_oauth_tenant_clients` | own | `api/models/tools.py:50` |
| `tool_published_apps` | own | `api/models/tools.py:514` |
| `tool_workflow_providers` | own | `api/models/tools.py:230` |
| `whitelists` | own | `api/models/dataset.py:1201` |

I: every entity above is owned rather than merely read by this feature — basis: its ORM class is defined in the model module this feature's controllers write through, and no other feature's controllers construct it [D: api/models/].

OPEN: which of these entities are also written by background jobs under `api/tasks/` outside this feature's request path? Ownership at the table level does not settle who writes at runtime.

## Feature ERD

`schema/erd_v1.17_F-005.puml` draws these entities.

## Field definitions

The readable rendering of `schema/schemas.json` `$defs`, which is the single definition of each shape.

### `account_integrates`

ORM class `AccountIntegrate` [D: api/models/account.py:320]. Primary key: `id`.

Unique: (`account_id`, `provider`); (`provider`, `open_id`)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `account_integrates.id` | UUID | Yes | primary key |
| `account_integrates.account_id` | UUID | Yes |  |
| `account_integrates.provider` | String | Yes |  |
| `account_integrates.open_id` | String | Yes |  |
| `account_integrates.encrypted_token` | String | Yes |  |
| `account_integrates.created_at` | DateTime | Yes |  |
| `account_integrates.updated_at` | DateTime | Yes |  |

### `account_plugin_permissions`

ORM class `TenantPluginPermission` [D: api/models/account.py:385]. Primary key: `id`.

Unique: (`tenant_id`)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `account_plugin_permissions.id` | UUID | Yes | primary key |
| `account_plugin_permissions.tenant_id` | UUID | Yes |  |
| `account_plugin_permissions.install_permission` | String | Yes | enum: everyone, admins, noone |
| `account_plugin_permissions.debug_permission` | String | Yes | enum: everyone, admins, noone |

### `account_step_by_step_tour_states`

ORM class `AccountStepByStepTourState` [D: api/models/onboarding.py:13]. Primary key: `id`.

Unique: (`account_id`)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `account_step_by_step_tour_states.id` | UUID | Yes | primary key |
| `account_step_by_step_tour_states.account_id` | UUID | Yes |  |
| `account_step_by_step_tour_states.first_workspace_id` | UUID | No |  |
| `account_step_by_step_tour_states.skipped` | Boolean | Yes |  |
| `account_step_by_step_tour_states.completed_task_ids` | Object | Yes |  |
| `account_step_by_step_tour_states.manually_enabled_workspace_ids` | Object | Yes |  |
| `account_step_by_step_tour_states.manually_disabled_workspace_ids` | Object | Yes |  |
| `account_step_by_step_tour_states.created_at` | DateTime | Yes |  |
| `account_step_by_step_tour_states.updated_at` | DateTime | Yes |  |

### `accounts`

ORM class `Account` [D: api/models/account.py:89]. Primary key: `id`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `accounts.id` | UUID | Yes | primary key |
| `accounts.name` | String | Yes |  |
| `accounts.email` | String | Yes |  |
| `accounts.normalized_email` | String | No |  |
| `accounts.password` | String | No |  |
| `accounts.password_salt` | String | No |  |
| `accounts.avatar` | String | No |  |
| `accounts.interface_language` | String | No |  |
| `accounts.interface_theme` | String | No |  |
| `accounts.timezone` | String | No |  |
| `accounts.last_login_at` | DateTime | No |  |
| `accounts.last_login_ip` | String | No |  |
| `accounts.last_active_at` | DateTime | Yes |  |
| `accounts.status` | String | No | enum: pending, uninitialized, active, banned, closed |
| `accounts.initialized_at` | DateTime | No |  |
| `accounts.created_at` | DateTime | Yes |  |
| `accounts.updated_at` | DateTime | Yes |  |

### `api_based_extensions`

ORM class `APIBasedExtension` [D: api/models/api_based_extension.py:20]. Primary key: `id`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `api_based_extensions.id` | UUID | Yes | primary key |
| `api_based_extensions.tenant_id` | UUID | Yes |  |
| `api_based_extensions.name` | String | Yes |  |
| `api_based_extensions.api_endpoint` | String | Yes |  |
| `api_based_extensions.api_key` | String | Yes |  |
| `api_based_extensions.created_at` | DateTime | Yes |  |

### `api_tokens`

ORM class `ApiToken` [D: api/models/model.py:2254]. Primary key: `id`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `api_tokens.id` | UUID | Yes | primary key |
| `api_tokens.app_id` | UUID | No |  |
| `api_tokens.tenant_id` | UUID | No |  |
| `api_tokens.type` | String | Yes | enum: app, dataset |
| `api_tokens.token` | String | Yes |  |
| `api_tokens.last_used_at` | DateTime | No |  |
| `api_tokens.created_at` | DateTime | Yes |  |

### `credential_permissions`

ORM class `CredentialPermission` [D: api/models/credential_permission.py:22]. Primary key: `id`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `credential_permissions.id` | UUID | Yes | primary key |
| `credential_permissions.credential_id` | UUID | Yes |  |
| `credential_permissions.credential_type` | String | Yes |  |
| `credential_permissions.account_id` | UUID | Yes |  |
| `credential_permissions.tenant_id` | UUID | Yes |  |
| `credential_permissions.has_permission` | Boolean | Yes |  |
| `credential_permissions.created_at` | DateTime | Yes |  |

### `invitation_codes`

ORM class `InvitationCode` [D: api/models/account.py:348]. Primary key: `id`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `invitation_codes.id` | Integer | Yes | primary key |
| `invitation_codes.batch` | String | Yes |  |
| `invitation_codes.code` | String | Yes |  |
| `invitation_codes.status` | String | No | enum: unused, used |
| `invitation_codes.used_at` | DateTime | No |  |
| `invitation_codes.used_by_tenant_id` | UUID | No |  |
| `invitation_codes.used_by_account_id` | UUID | No |  |
| `invitation_codes.deprecated_at` | DateTime | No |  |
| `invitation_codes.created_at` | DateTime | Yes |  |

### `load_balancing_model_configs`

ORM class `LoadBalancingModelConfig` [D: api/models/provider.py:274]. Primary key: `id`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `load_balancing_model_configs.id` | UUID | Yes | primary key |
| `load_balancing_model_configs.tenant_id` | UUID | Yes |  |
| `load_balancing_model_configs.provider_name` | String | Yes |  |
| `load_balancing_model_configs.model_name` | String | Yes |  |
| `load_balancing_model_configs.model_type` | String | Yes |  |
| `load_balancing_model_configs.name` | String | Yes |  |
| `load_balancing_model_configs.encrypted_config` | String | No |  |
| `load_balancing_model_configs.credential_id` | UUID | No |  |
| `load_balancing_model_configs.credential_source_type` | String | No | enum: provider, custom_model |
| `load_balancing_model_configs.enabled` | Boolean | Yes |  |
| `load_balancing_model_configs.created_at` | DateTime | Yes |  |
| `load_balancing_model_configs.updated_at` | DateTime | Yes |  |

### `oauth_access_tokens`

ORM class `OAuthAccessToken` [D: api/models/oauth.py:97]. Primary key: `id`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `oauth_access_tokens.id` | UUID | Yes | primary key |
| `oauth_access_tokens.subject_email` | String | Yes |  |
| `oauth_access_tokens.client_id` | String | Yes |  |
| `oauth_access_tokens.device_label` | String | Yes |  |
| `oauth_access_tokens.prefix` | String | Yes |  |
| `oauth_access_tokens.expires_at` | DateTime | Yes |  |
| `oauth_access_tokens.subject_issuer` | String | No |  |
| `oauth_access_tokens.account_id` | UUID | No |  |
| `oauth_access_tokens.token_hash` | String | No |  |
| `oauth_access_tokens.last_used_at` | DateTime | No |  |
| `oauth_access_tokens.revoked_at` | DateTime | No |  |
| `oauth_access_tokens.created_at` | DateTime | Yes |  |

### `oauth_provider_apps`

ORM class `OAuthProviderApp` [D: api/models/model.py:1074]. Primary key: `id`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `oauth_provider_apps.id` | UUID | Yes | primary key |
| `oauth_provider_apps.app_icon` | String | Yes |  |
| `oauth_provider_apps.client_id` | String | Yes |  |
| `oauth_provider_apps.client_secret` | String | Yes |  |
| `oauth_provider_apps.app_label` | Object | Yes |  |
| `oauth_provider_apps.redirect_uris` | Object | Yes |  |
| `oauth_provider_apps.scope` | String | Yes |  |
| `oauth_provider_apps.auto_authorize` | Boolean | Yes |  |
| `oauth_provider_apps.created_at` | DateTime | Yes |  |

### `provider_credentials`

ORM class `ProviderCredential` [D: api/models/provider.py:307]. Primary key: `id`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `provider_credentials.id` | UUID | Yes | primary key |
| `provider_credentials.tenant_id` | UUID | Yes |  |
| `provider_credentials.provider_name` | String | Yes |  |
| `provider_credentials.credential_name` | String | Yes |  |
| `provider_credentials.encrypted_config` | String | Yes |  |
| `provider_credentials.user_id` | UUID | No |  |
| `provider_credentials.visibility` | String | Yes | enum: only_me, all_team_members, partial_members |
| `provider_credentials.created_at` | DateTime | Yes |  |
| `provider_credentials.updated_at` | DateTime | Yes |  |

### `provider_model_credentials`

ORM class `ProviderModelCredential` [D: api/models/provider.py:340]. Primary key: `id`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `provider_model_credentials.id` | UUID | Yes | primary key |
| `provider_model_credentials.tenant_id` | UUID | Yes |  |
| `provider_model_credentials.provider_name` | String | Yes |  |
| `provider_model_credentials.model_name` | String | Yes |  |
| `provider_model_credentials.model_type` | String | Yes |  |
| `provider_model_credentials.credential_name` | String | Yes |  |
| `provider_model_credentials.encrypted_config` | String | Yes |  |
| `provider_model_credentials.created_at` | DateTime | Yes |  |
| `provider_model_credentials.updated_at` | DateTime | Yes |  |

### `provider_model_settings`

ORM class `ProviderModelSetting` [D: api/models/provider.py:244]. Primary key: `id`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `provider_model_settings.id` | UUID | Yes | primary key |
| `provider_model_settings.tenant_id` | UUID | Yes |  |
| `provider_model_settings.provider_name` | String | Yes |  |
| `provider_model_settings.model_name` | String | Yes |  |
| `provider_model_settings.model_type` | String | Yes |  |
| `provider_model_settings.enabled` | Boolean | Yes |  |
| `provider_model_settings.load_balancing_enabled` | Boolean | Yes |  |
| `provider_model_settings.created_at` | DateTime | Yes |  |
| `provider_model_settings.updated_at` | DateTime | Yes |  |

### `provider_models`

ORM class `ProviderModel` [D: api/models/provider.py:118]. Primary key: `id`.

Unique: (`tenant_id`, `provider_name`, `model_name`, `model_type`)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `provider_models.id` | UUID | Yes | primary key |
| `provider_models.tenant_id` | UUID | Yes |  |
| `provider_models.provider_name` | String | Yes |  |
| `provider_models.model_name` | String | Yes |  |
| `provider_models.model_type` | String | Yes |  |
| `provider_models.credential_id` | UUID | No |  |
| `provider_models.is_valid` | Boolean | Yes |  |
| `provider_models.created_at` | DateTime | Yes |  |
| `provider_models.updated_at` | DateTime | Yes |  |

### `provider_orders`

ORM class `ProviderOrder` [D: api/models/provider.py:211]. Primary key: `id`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `provider_orders.id` | UUID | Yes | primary key |
| `provider_orders.tenant_id` | UUID | Yes |  |
| `provider_orders.provider_name` | String | Yes |  |
| `provider_orders.account_id` | UUID | Yes |  |
| `provider_orders.payment_product_id` | String | Yes |  |
| `provider_orders.payment_id` | String | No |  |
| `provider_orders.transaction_id` | String | No |  |
| `provider_orders.quantity` | Integer | Yes |  |
| `provider_orders.currency` | String | No |  |
| `provider_orders.total_amount` | Integer | No |  |
| `provider_orders.payment_status` | String | Yes | enum: wait_pay, paid, failed, refunded |
| `provider_orders.paid_at` | DateTime | No |  |
| `provider_orders.pay_failed_at` | DateTime | No |  |
| `provider_orders.refunded_at` | DateTime | No |  |
| `provider_orders.created_at` | DateTime | Yes |  |
| `provider_orders.updated_at` | DateTime | Yes |  |

### `providers`

ORM class `Provider` [D: api/models/provider.py:34]. Primary key: `id`.

Unique: (`tenant_id`, `provider_name`, `provider_type`, `quota_type`)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `providers.id` | UUID | Yes | primary key |
| `providers.tenant_id` | UUID | Yes |  |
| `providers.provider_name` | String | Yes |  |
| `providers.provider_type` | String | Yes |  |
| `providers.is_valid` | Boolean | Yes |  |
| `providers.last_used` | DateTime | No |  |
| `providers.credential_id` | UUID | No |  |
| `providers.quota_type` | String | No | enum: paid, free, trial |
| `providers.quota_limit` | Integer | No |  |
| `providers.quota_used` | Integer | No |  |
| `providers.created_at` | DateTime | Yes |  |
| `providers.updated_at` | DateTime | Yes |  |

### `rate_limit_logs`

ORM class `RateLimitLog` [D: api/models/dataset.py:1346]. Primary key: `id`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `rate_limit_logs.id` | UUID | Yes | primary key |
| `rate_limit_logs.tenant_id` | UUID | Yes |  |
| `rate_limit_logs.subscription_plan` | String | Yes |  |
| `rate_limit_logs.operation` | String | Yes |  |
| `rate_limit_logs.created_at` | DateTime | Yes |  |

### `tenant_account_joins`

ORM class `TenantAccountJoin` [D: api/models/account.py:292]. Primary key: `id`.

Unique: (`tenant_id`, `account_id`)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `tenant_account_joins.id` | UUID | Yes | primary key |
| `tenant_account_joins.tenant_id` | UUID | Yes |  |
| `tenant_account_joins.account_id` | UUID | Yes |  |
| `tenant_account_joins.current` | Boolean | No |  |
| `tenant_account_joins.role` | String | No | enum: owner, admin, editor, normal, dataset_operator |
| `tenant_account_joins.invited_by` | UUID | No |  |
| `tenant_account_joins.created_at` | DateTime | Yes |  |
| `tenant_account_joins.updated_at` | DateTime | Yes |  |
| `tenant_account_joins.last_opened_at` | DateTime | No |  |

### `tenant_default_models`

ORM class `TenantDefaultModel` [D: api/models/provider.py:167]. Primary key: `id`.

Unique: (`tenant_id`, `model_type`)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `tenant_default_models.id` | UUID | Yes | primary key |
| `tenant_default_models.tenant_id` | UUID | Yes |  |
| `tenant_default_models.provider_name` | String | Yes |  |
| `tenant_default_models.model_name` | String | Yes |  |
| `tenant_default_models.model_type` | String | Yes |  |
| `tenant_default_models.created_at` | DateTime | Yes |  |
| `tenant_default_models.updated_at` | DateTime | Yes |  |

### `tenant_plugin_auto_upgrade_strategies`

ORM class `TenantPluginAutoUpgradeStrategy` [D: api/models/account.py:431]. Primary key: `id`.

Unique: (`tenant_id`, `category`)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `tenant_plugin_auto_upgrade_strategies.id` | UUID | Yes | primary key |
| `tenant_plugin_auto_upgrade_strategies.tenant_id` | UUID | Yes |  |
| `tenant_plugin_auto_upgrade_strategies.category` | String | Yes | enum: tool, model, extension, agent-strategy, datasource, trigger |
| `tenant_plugin_auto_upgrade_strategies.strategy_setting` | String | Yes | enum: disabled, fix_only, latest |
| `tenant_plugin_auto_upgrade_strategies.upgrade_mode` | String | Yes | enum: all, partial, exclude |
| `tenant_plugin_auto_upgrade_strategies.exclude_plugins` | Object | Yes |  |
| `tenant_plugin_auto_upgrade_strategies.include_plugins` | Object | Yes |  |
| `tenant_plugin_auto_upgrade_strategies.upgrade_time_of_day` | Integer | Yes |  |
| `tenant_plugin_auto_upgrade_strategies.created_at` | DateTime | Yes |  |
| `tenant_plugin_auto_upgrade_strategies.updated_at` | DateTime | Yes |  |

### `tenant_preferred_model_providers`

ORM class `TenantPreferredModelProvider` [D: api/models/provider.py:190]. Primary key: `id`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `tenant_preferred_model_providers.id` | UUID | Yes | primary key |
| `tenant_preferred_model_providers.tenant_id` | UUID | Yes |  |
| `tenant_preferred_model_providers.provider_name` | String | Yes |  |
| `tenant_preferred_model_providers.preferred_provider_type` | String | Yes |  |
| `tenant_preferred_model_providers.created_at` | DateTime | Yes |  |
| `tenant_preferred_model_providers.updated_at` | DateTime | Yes |  |

### `tenants`

ORM class `Tenant` [D: api/models/account.py:253]. Primary key: `id`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `tenants.id` | UUID | Yes | primary key |
| `tenants.name` | String | Yes |  |
| `tenants.encrypt_public_key` | String | No |  |
| `tenants.plan` | String | No |  |
| `tenants.status` | String | No | enum: normal, archive |
| `tenants.custom_config` | String | No |  |
| `tenants.created_at` | DateTime | Yes |  |
| `tenants.updated_at` | DateTime | No |  |

### `tool_api_providers`

ORM class `ApiToolProvider` [D: api/models/tools.py:134]. Primary key: `id`.

Unique: (`name`, `tenant_id`)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `tool_api_providers.id` | UUID | Yes | primary key |
| `tool_api_providers.name` | String | Yes |  |
| `tool_api_providers.icon` | String | Yes |  |
| `tool_api_providers.schema` | String | Yes |  |
| `tool_api_providers.schema_type_str` | String | Yes |  |
| `tool_api_providers.user_id` | UUID | Yes |  |
| `tool_api_providers.tenant_id` | UUID | Yes |  |
| `tool_api_providers.description` | String | Yes |  |
| `tool_api_providers.tools_str` | String | Yes |  |
| `tool_api_providers.credentials_str` | String | Yes |  |
| `tool_api_providers.privacy_policy` | String | No |  |
| `tool_api_providers.custom_disclaimer` | String | No |  |
| `tool_api_providers.created_at` | DateTime | Yes |  |
| `tool_api_providers.updated_at` | DateTime | Yes |  |

### `tool_builtin_providers`

ORM class `BuiltinToolProvider` [D: api/models/tools.py:73]. Primary key: `id`.

Unique: (`tenant_id`, `provider`, `name`)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `tool_builtin_providers.id` | UUID | Yes | primary key |
| `tool_builtin_providers.name` | String | Yes |  |
| `tool_builtin_providers.tenant_id` | UUID | No |  |
| `tool_builtin_providers.user_id` | UUID | Yes |  |
| `tool_builtin_providers.provider` | String | Yes |  |
| `tool_builtin_providers.encrypted_credentials` | String | No |  |
| `tool_builtin_providers.created_at` | DateTime | Yes |  |
| `tool_builtin_providers.updated_at` | DateTime | Yes |  |
| `tool_builtin_providers.is_default` | Boolean | Yes |  |
| `tool_builtin_providers.credential_type` | String | Yes | enum: trigger_subscription, builtin_tool_provider, datasource_provider, provider_credential |
| `tool_builtin_providers.expires_at` | Integer | Yes |  |
| `tool_builtin_providers.visibility` | String | Yes | enum: only_me, all_team_members, partial_members |

### `tool_conversation_variables`

ORM class `ToolConversationVariables` [D: api/models/tools.py:440]. Primary key: `id`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `tool_conversation_variables.id` | UUID | Yes | primary key |
| `tool_conversation_variables.user_id` | UUID | Yes |  |
| `tool_conversation_variables.tenant_id` | UUID | Yes |  |
| `tool_conversation_variables.conversation_id` | UUID | Yes |  |
| `tool_conversation_variables.variables_str` | String | Yes |  |
| `tool_conversation_variables.created_at` | DateTime | Yes |  |
| `tool_conversation_variables.updated_at` | DateTime | Yes |  |

### `tool_files`

ORM class `ToolFile` [D: api/models/tools.py:481]. Primary key: `id`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `tool_files.id` | UUID | Yes | primary key |
| `tool_files.user_id` | UUID | Yes |  |
| `tool_files.tenant_id` | UUID | Yes |  |
| `tool_files.conversation_id` | UUID | No |  |
| `tool_files.file_key` | String | Yes |  |
| `tool_files.mimetype` | String | Yes |  |
| `tool_files.original_url` | String | No |  |
| `tool_files.name` | String | No |  |
| `tool_files.size` | Integer | No |  |

### `tool_label_bindings`

ORM class `ToolLabelBinding` [D: api/models/tools.py:208]. Primary key: `id`.

Unique: (`tool_id`, `label_name`)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `tool_label_bindings.id` | UUID | Yes | primary key |
| `tool_label_bindings.tool_id` | String | Yes |  |
| `tool_label_bindings.tool_type` | String | Yes |  |
| `tool_label_bindings.label_name` | String | Yes |  |

### `tool_mcp_providers`

ORM class `MCPToolProvider` [D: api/models/tools.py:294]. Primary key: `id`.

Unique: (`tenant_id`, `server_url_hash`); (`tenant_id`, `name`); (`tenant_id`, `server_identifier`)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `tool_mcp_providers.id` | UUID | Yes | primary key |
| `tool_mcp_providers.name` | String | Yes |  |
| `tool_mcp_providers.server_identifier` | String | Yes |  |
| `tool_mcp_providers.server_url` | String | Yes |  |
| `tool_mcp_providers.server_url_hash` | String | Yes |  |
| `tool_mcp_providers.icon` | String | No |  |
| `tool_mcp_providers.tenant_id` | UUID | Yes |  |
| `tool_mcp_providers.user_id` | UUID | Yes |  |
| `tool_mcp_providers.encrypted_credentials` | String | No |  |
| `tool_mcp_providers.authed` | Boolean | Yes |  |
| `tool_mcp_providers.tools` | String | Yes |  |
| `tool_mcp_providers.created_at` | DateTime | Yes |  |
| `tool_mcp_providers.updated_at` | DateTime | Yes |  |
| `tool_mcp_providers.timeout` | Number | Yes |  |
| `tool_mcp_providers.sse_read_timeout` | Number | Yes |  |
| `tool_mcp_providers.encrypted_headers` | String | No |  |
| `tool_mcp_providers.identity_mode` | String | Yes |  |

### `tool_model_invokes`

ORM class `ToolModelInvoke` [D: api/models/tools.py:390]. Primary key: `id`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `tool_model_invokes.id` | UUID | Yes | primary key |
| `tool_model_invokes.user_id` | UUID | Yes |  |
| `tool_model_invokes.tenant_id` | UUID | Yes |  |
| `tool_model_invokes.provider` | String | Yes |  |
| `tool_model_invokes.tool_type` | String | Yes |  |
| `tool_model_invokes.tool_name` | String | Yes |  |
| `tool_model_invokes.model_parameters` | String | Yes |  |
| `tool_model_invokes.prompt_messages` | String | Yes |  |
| `tool_model_invokes.model_response` | String | Yes |  |
| `tool_model_invokes.prompt_tokens` | Integer | Yes |  |
| `tool_model_invokes.answer_tokens` | Integer | Yes |  |
| `tool_model_invokes.answer_unit_price` | Number | Yes |  |
| `tool_model_invokes.answer_price_unit` | Number | Yes |  |
| `tool_model_invokes.provider_response_latency` | Number | Yes |  |
| `tool_model_invokes.total_price` | Number | No |  |
| `tool_model_invokes.currency` | String | Yes |  |
| `tool_model_invokes.created_at` | DateTime | Yes |  |
| `tool_model_invokes.updated_at` | DateTime | Yes |  |

### `tool_oauth_system_clients`

ORM class `ToolOAuthSystemClient` [D: api/models/tools.py:33]. Primary key: `id`.

Unique: (`plugin_id`, `provider`)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `tool_oauth_system_clients.id` | UUID | Yes | primary key |
| `tool_oauth_system_clients.plugin_id` | String | Yes |  |
| `tool_oauth_system_clients.provider` | String | Yes |  |
| `tool_oauth_system_clients.encrypted_oauth_params` | String | Yes |  |

### `tool_oauth_tenant_clients`

ORM class `ToolOAuthTenantClient` [D: api/models/tools.py:50]. Primary key: `id`.

Unique: (`tenant_id`, `plugin_id`, `provider`)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `tool_oauth_tenant_clients.id` | UUID | Yes | primary key |
| `tool_oauth_tenant_clients.tenant_id` | UUID | Yes |  |
| `tool_oauth_tenant_clients.plugin_id` | String | Yes |  |
| `tool_oauth_tenant_clients.provider` | String | Yes |  |
| `tool_oauth_tenant_clients.enabled` | Boolean | Yes |  |
| `tool_oauth_tenant_clients.encrypted_oauth_params` | String | Yes |  |

### `tool_published_apps`

ORM class `DeprecatedPublishedAppTool` [D: api/models/tools.py:514]. Primary key: `id`.

Unique: (`app_id`, `user_id`)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `tool_published_apps.id` | UUID | Yes | primary key |
| `tool_published_apps.app_id` | UUID | Yes | FK -> apps.id |
| `tool_published_apps.user_id` | UUID | Yes |  |
| `tool_published_apps.description` | String | Yes |  |
| `tool_published_apps.llm_description` | String | Yes |  |
| `tool_published_apps.query_description` | String | Yes |  |
| `tool_published_apps.query_name` | String | Yes |  |
| `tool_published_apps.tool_name` | String | Yes |  |
| `tool_published_apps.author` | String | Yes |  |
| `tool_published_apps.created_at` | DateTime | Yes |  |
| `tool_published_apps.updated_at` | DateTime | Yes |  |

### `tool_workflow_providers`

ORM class `WorkflowToolProvider` [D: api/models/tools.py:230]. Primary key: `id`.

Unique: (`name`, `tenant_id`); (`tenant_id`, `app_id`)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `tool_workflow_providers.id` | UUID | Yes | primary key |
| `tool_workflow_providers.name` | String | Yes |  |
| `tool_workflow_providers.label` | String | Yes |  |
| `tool_workflow_providers.icon` | String | Yes |  |
| `tool_workflow_providers.app_id` | UUID | Yes |  |
| `tool_workflow_providers.version` | String | Yes |  |
| `tool_workflow_providers.user_id` | UUID | Yes |  |
| `tool_workflow_providers.tenant_id` | UUID | Yes |  |
| `tool_workflow_providers.description` | String | Yes |  |
| `tool_workflow_providers.parameter_configuration` | String | Yes |  |
| `tool_workflow_providers.privacy_policy` | String | No |  |
| `tool_workflow_providers.created_at` | DateTime | Yes |  |
| `tool_workflow_providers.updated_at` | DateTime | Yes |  |

### `whitelists`

ORM class `Whitelist` [D: api/models/dataset.py:1201]. Primary key: `id`.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `whitelists.id` | UUID | Yes | primary key |
| `whitelists.tenant_id` | UUID | No |  |
| `whitelists.category` | String | Yes |  |
| `whitelists.created_at` | DateTime | Yes |  |

## New and changed entities

This is an as-built record: every entity above already exists in the running schema. Registry rows are in `data-master-erd.md`.

OPEN: which release introduced each entity? Recoverable only from migration filenames, and that dates the migration rather than the feature.

## Migrations

Schema changes for these tables are Alembic revisions in `api/migrations/versions/`, applied in revision order [D: api/migrations/versions/].

OPEN: are the `downgrade()` functions in those revisions exercised anywhere? CI runs a migration job [D: .github/workflows/db-migration-test.yml] but nothing states that it tests the reverse direction.

## Traceability

Domain rules in `ddd/`; stories in `PRDs/prd_v1.17_F-005-*.md`.

OPEN: no column in this repository carries a comment naming the requirement it exists for, so no field-level traceability is recoverable.
