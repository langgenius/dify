---
title: API Contract v1.17 F-005 — Workspace, Identity and Access
id: F-005
status: draft
owner: TBD
updated: 2026-09-20
---

# API Contract v1.17 F-005 — Workspace, Identity and Access

> As-built. Paths are composed: Blueprint `url_prefix` + the literal in the route decorator.

## Surface summary

232 operations over 199 paths [D: api/controllers/].

- 232 on the Console API (browser session, `/console/api`) [D: api/controllers/console/__init__.py]

226 of these carry at least one guard decorator; 6 carry none [D: api/controllers/].

This feature deliberately exposes no other surface: the table below is the complete set of routes whose handler files belong to it.

## Endpoints

| Method | Path | Auth guards | Handler |
| --- | --- | --- | --- |
| `GET` | `/console/api/account/avatar` | `@console_account_admission` | `api/controllers/console/workspace/account.py:350` |
| `POST` | `/console/api/account/avatar` | `@console_account_admission` | `api/controllers/console/workspace/account.py:350` |
| `POST` | `/console/api/account/change-email` | `@console_account_admission` | `api/controllers/console/workspace/account.py:576` |
| `POST` | `/console/api/account/change-email/check-email-unique` | `@setup_required` | `api/controllers/console/workspace/account.py:661` |
| `POST` | `/console/api/account/change-email/reset` | `@console_account_admission` | `api/controllers/console/workspace/account.py:634` |
| `POST` | `/console/api/account/change-email/validity` | `@console_account_admission` | `api/controllers/console/workspace/account.py:607` |
| `POST` | `/console/api/account/delete` | `@console_account_admission` | `api/controllers/console/workspace/account.py:487` |
| `POST` | `/console/api/account/delete/feedback` | `@setup_required` | `api/controllers/console/workspace/account.py:506` |
| `GET` | `/console/api/account/delete/verify` | `@console_account_admission` | `api/controllers/console/workspace/account.py:472` |
| `GET` | `/console/api/account/education` | `@console_account_admission` | `api/controllers/console/workspace/account.py:532` |
| `POST` | `/console/api/account/education` | `@console_account_admission` | `api/controllers/console/workspace/account.py:532` |
| `GET` | `/console/api/account/education/autocomplete` | `@console_account_admission` | `api/controllers/console/workspace/account.py:558` |
| `GET` | `/console/api/account/education/verify` | `@console_account_admission` | `api/controllers/console/workspace/account.py:518` |
| `POST` | `/console/api/account/init` | `@console_account_admission` | `api/controllers/console/workspace/account.py:290` |
| `GET` | `/console/api/account/integrates` | `@console_account_admission` | `api/controllers/console/workspace/account.py:451` |
| `POST` | `/console/api/account/interface-language` | `@console_account_admission` | `api/controllers/console/workspace/account.py:376` |
| `POST` | `/console/api/account/interface-theme` | `@console_account_admission` | `api/controllers/console/workspace/account.py:394` |
| `POST` | `/console/api/account/name` | `@console_account_admission` | `api/controllers/console/workspace/account.py:335` |
| `POST` | `/console/api/account/password` | `@console_account_admission` | `api/controllers/console/workspace/account.py:427` |
| `GET` | `/console/api/account/profile` | `@console_account_admission` | `api/controllers/console/workspace/account.py:316` |
| `PATCH` | `/console/api/account/profile` | `@console_account_admission` | `api/controllers/console/workspace/account.py:316` |
| `POST` | `/console/api/account/timezone` | `@console_account_admission` | `api/controllers/console/workspace/account.py:412` |
| `POST` | `/console/api/activate` | public / token-in-URL | `api/controllers/console/auth/activate.py:107` |
| `GET` | `/console/api/activate/check` | public / token-in-URL | `api/controllers/console/auth/activate.py:82` |
| `GET` | `/console/api/all-workspaces` | `@admin_required`, `@setup_required` | `api/controllers/console/workspace/workspace.py:238` |
| `GET` | `/console/api/api-key-auth/data-source` | `@console_account_admission` | `api/controllers/console/auth/data_source_bearer_auth.py:78` |
| `DELETE` | `/console/api/api-key-auth/data-source/<uuid:binding_id>` | `@console_account_admission` | `api/controllers/console/auth/data_source_bearer_auth.py:135` |
| `POST` | `/console/api/api-key-auth/data-source/binding` | `@console_account_admission` | `api/controllers/console/auth/data_source_bearer_auth.py:102` |
| `GET` | `/console/api/apps/<uuid:resource_id>/api-keys` | `@edit_permission_required`, `@rbac_permission_required` | `api/controllers/console/apikey.py:236` |
| `POST` | `/console/api/apps/<uuid:resource_id>/api-keys` | `@edit_permission_required`, `@rbac_permission_required` | `api/controllers/console/apikey.py:236` |
| `DELETE` | `/console/api/apps/<uuid:resource_id>/api-keys/<uuid:api_key_id>` | `@rbac_permission_required` | `api/controllers/console/apikey.py:281` |
| `GET` | `/console/api/billing/invoices` | `@console_account_admission` | `api/controllers/console/billing/billing.py:99` |
| `PUT` | `/console/api/billing/partners/<string:partner_key>/tenants` | `@console_account_admission` | `api/controllers/console/billing/billing.py:125` |
| `GET` | `/console/api/billing/subscription` | `@console_account_admission` | `api/controllers/console/billing/billing.py:62` |
| `GET` | `/console/api/compliance/download` | `@console_account_admission` | `api/controllers/console/billing/compliance.py:47` |
| `POST` | `/console/api/email-code-login` | `@setup_required` | `api/controllers/console/auth/login.py:191` |
| `POST` | `/console/api/email-code-login/validity` | `@decrypt_code_field`, `@setup_required` | `api/controllers/console/auth/login.py:212` |
| `POST` | `/console/api/email-register` | `@console_email_registration_admission` | `api/controllers/console/auth/email_register.py:149` |
| `POST` | `/console/api/email-register/send-email` | `@console_email_registration_admission` | `api/controllers/console/auth/email_register.py:94` |
| `POST` | `/console/api/email-register/validity` | `@console_email_registration_admission` | `api/controllers/console/auth/email_register.py:118` |
| `POST` | `/console/api/forgot-password` | `@email_password_login_enabled`, `@setup_required` | `api/controllers/console/auth/forgot_password.py:53` |
| `POST` | `/console/api/forgot-password/resets` | `@email_password_login_enabled`, `@setup_required` | `api/controllers/console/auth/forgot_password.py:120` |
| `POST` | `/console/api/forgot-password/validity` | `@email_password_login_enabled`, `@setup_required` | `api/controllers/console/auth/forgot_password.py:84` |
| `POST` | `/console/api/login` | `@decrypt_password_field`, `@email_password_login_enabled`, `@setup_required` | `api/controllers/console/auth/login.py:120` |
| `POST` | `/console/api/logout` | `@setup_required` | `api/controllers/console/auth/login.py:155` |
| `GET` | `/console/api/mcp/oauth/callback` | public / token-in-URL | `api/controllers/console/workspace/tool_providers.py:1631` |
| `GET` | `/console/api/oauth/authorize/<provider>` | `@setup_required`, `@social_oauth_login_enabled` | `api/controllers/console/auth/oauth.py:171` |
| `GET` | `/console/api/oauth/data-source/<string:provider>` | `@console_account_admission` | `api/controllers/console/auth/data_source_oauth.py:101` |
| `GET` | `/console/api/oauth/data-source/<string:provider>/<uuid:binding_id>/sync` | `@console_account_admission` | `api/controllers/console/auth/data_source_oauth.py:187` |
| `GET` | `/console/api/oauth/data-source/binding/<string:provider>` | `@console_account_admission` | `api/controllers/console/auth/data_source_oauth.py:154` |
| `GET` | `/console/api/oauth/data-source/callback/<string:provider>` | public / token-in-URL | `api/controllers/console/auth/data_source_oauth.py:131` |
| `GET` | `/console/api/oauth/login/<provider>` | `@setup_required`, `@social_oauth_login_enabled` | `api/controllers/console/auth/oauth.py:144` |
| `GET` | `/console/api/oauth/plugin/<path:provider>/tool/authorization-url` | `@account_initialization_required`, `@is_admin_or_owner_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/workspace/tool_providers.py:1117` |
| `GET` | `/console/api/oauth/plugin/<path:provider>/tool/callback` | `@setup_required` | `api/controllers/console/workspace/tool_providers.py:1182` |
| `POST` | `/console/api/oauth/provider` | `@setup_required` | `api/controllers/console/auth/oauth_server.py:120` |
| `POST` | `/console/api/oauth/provider/account` | `@setup_required` | `api/controllers/console/auth/oauth_server.py:175` |
| `POST` | `/console/api/oauth/provider/authorize` | `@console_account_admission` | `api/controllers/console/auth/oauth_server.py:137` |
| `POST` | `/console/api/oauth/provider/token` | `@setup_required` | `api/controllers/console/auth/oauth_server.py:154` |
| `POST` | `/console/api/refresh-token` | public / token-in-URL | `api/controllers/console/auth/login.py:237` |
| `POST` | `/console/api/reset-password` | `@email_password_login_enabled`, `@setup_required` | `api/controllers/console/auth/login.py:172` |
| `GET` | `/console/api/workspaces` | `@console_account_admission` | `api/controllers/console/workspace/workspace.py:229` |
| `GET` | `/console/api/workspaces/<string:tenant_id>/model-providers/<path:provider>/<string:icon_type>/<string:lang>` | public / token-in-URL | `api/controllers/console/workspace/model_providers.py:347` |
| `GET` | `/console/api/workspaces/current/agent-provider/<path:provider_name>` | `@account_initialization_required`, `@login_required`, `@setup_required` | `api/controllers/console/workspace/agent_providers.py:49` |
| `GET` | `/console/api/workspaces/current/agent-providers` | `@account_initialization_required`, `@login_required`, `@setup_required` | `api/controllers/console/workspace/agent_providers.py:31` |
| `GET` | `/console/api/workspaces/current/agents/<string:agent_id>/skills` | `@console_account_admission`, `@edit_permission_required` | `api/controllers/console/workspace/skills.py:811` |
| `PUT` | `/console/api/workspaces/current/agents/<string:agent_id>/skills` | `@console_account_admission`, `@edit_permission_required` | `api/controllers/console/workspace/skills.py:811` |
| `GET` | `/console/api/workspaces/current/dataset-operators` | `@account_initialization_required`, `@login_required`, `@setup_required` | `api/controllers/console/workspace/members.py:402` |
| `GET` | `/console/api/workspaces/current/default-model` | `@account_initialization_required`, `@is_admin_or_owner_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/workspace/models.py:205` |
| `POST` | `/console/api/workspaces/current/default-model` | `@account_initialization_required`, `@is_admin_or_owner_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/workspace/models.py:205` |
| `POST` | `/console/api/workspaces/current/endpoints` | `@account_initialization_required`, `@is_admin_or_owner_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/workspace/endpoint.py:222` |
| `DELETE` | `/console/api/workspaces/current/endpoints/<string:id>` | `@account_initialization_required`, `@is_admin_or_owner_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/workspace/endpoint.py:342` |
| `PATCH` | `/console/api/workspaces/current/endpoints/<string:id>` | `@account_initialization_required`, `@is_admin_or_owner_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/workspace/endpoint.py:342` |
| `POST` | `/console/api/workspaces/current/endpoints/create` | `@account_initialization_required`, `@is_admin_or_owner_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/workspace/endpoint.py:249` |
| `POST` | `/console/api/workspaces/current/endpoints/delete` | `@account_initialization_required`, `@is_admin_or_owner_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/workspace/endpoint.py:391` |
| `POST` | `/console/api/workspaces/current/endpoints/disable` | `@account_initialization_required`, `@is_admin_or_owner_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/workspace/endpoint.py:482` |
| `POST` | `/console/api/workspaces/current/endpoints/enable` | `@account_initialization_required`, `@is_admin_or_owner_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/workspace/endpoint.py:457` |
| `GET` | `/console/api/workspaces/current/endpoints/list` | `@account_initialization_required`, `@is_admin_or_owner_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/workspace/endpoint.py:281` |
| `GET` | `/console/api/workspaces/current/endpoints/list/plugin` | `@account_initialization_required`, `@is_admin_or_owner_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/workspace/endpoint.py:311` |
| `POST` | `/console/api/workspaces/current/endpoints/update` | `@account_initialization_required`, `@is_admin_or_owner_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/workspace/endpoint.py:424` |
| `GET` | `/console/api/workspaces/current/members` | `@console_account_admission` | `api/controllers/console/workspace/members.py:201` |
| `DELETE` | `/console/api/workspaces/current/members/<uuid:member_id>` | `@account_initialization_required`, `@login_required`, `@setup_required` | `api/controllers/console/workspace/members.py:323` |
| `POST` | `/console/api/workspaces/current/members/<uuid:member_id>/owner-transfer` | `@account_initialization_required`, `@is_allow_transfer_owner`, `@login_required`, `@setup_required` | `api/controllers/console/workspace/members.py:503` |
| `PUT` | `/console/api/workspaces/current/members/<uuid:member_id>/update-role` | `@account_initialization_required`, `@login_required`, `@setup_required` | `api/controllers/console/workspace/members.py:358` |
| `POST` | `/console/api/workspaces/current/members/invite-email` | `@account_initialization_required`, `@login_required`, `@setup_required` | `api/controllers/console/workspace/members.py:227` |
| `POST` | `/console/api/workspaces/current/members/owner-transfer-check` | `@account_initialization_required`, `@is_allow_transfer_owner`, `@login_required`, `@setup_required` | `api/controllers/console/workspace/members.py:458` |
| `POST` | `/console/api/workspaces/current/members/send-owner-transfer-confirm-email` | `@account_initialization_required`, `@is_allow_transfer_owner`, `@login_required`, `@setup_required` | `api/controllers/console/workspace/members.py:418` |
| `GET` | `/console/api/workspaces/current/model-providers` | `@account_initialization_required`, `@login_required`, `@setup_required` | `api/controllers/console/workspace/model_providers.py:148` |
| `GET` | `/console/api/workspaces/current/model-providers/<path:provider>/checkout-url` | `@account_initialization_required`, `@is_admin_or_owner_required`, `@login_required`, `@setup_required` | `api/controllers/console/workspace/model_providers.py:388` |
| `DELETE` | `/console/api/workspaces/current/model-providers/<path:provider>/credentials` | `@account_initialization_required`, `@is_admin_or_owner_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/workspace/model_providers.py:200` |
| `GET` | `/console/api/workspaces/current/model-providers/<path:provider>/credentials` | `@account_initialization_required`, `@is_admin_or_owner_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/workspace/model_providers.py:200` |
| `POST` | `/console/api/workspaces/current/model-providers/<path:provider>/credentials` | `@account_initialization_required`, `@is_admin_or_owner_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/workspace/model_providers.py:200` |
| `PUT` | `/console/api/workspaces/current/model-providers/<path:provider>/credentials` | `@account_initialization_required`, `@is_admin_or_owner_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/workspace/model_providers.py:200` |
| `POST` | `/console/api/workspaces/current/model-providers/<path:provider>/credentials/switch` | `@account_initialization_required`, `@is_admin_or_owner_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/workspace/model_providers.py:291` |
| `POST` | `/console/api/workspaces/current/model-providers/<path:provider>/credentials/validate` | `@account_initialization_required`, `@login_required`, `@setup_required` | `api/controllers/console/workspace/model_providers.py:312` |
| `DELETE` | `/console/api/workspaces/current/model-providers/<path:provider>/models` | `@account_initialization_required`, `@is_admin_or_owner_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/workspace/models.py:259` |
| `GET` | `/console/api/workspaces/current/model-providers/<path:provider>/models` | `@account_initialization_required`, `@is_admin_or_owner_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/workspace/models.py:259` |
| `POST` | `/console/api/workspaces/current/model-providers/<path:provider>/models` | `@account_initialization_required`, `@is_admin_or_owner_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/workspace/models.py:259` |
| `DELETE` | `/console/api/workspaces/current/model-providers/<path:provider>/models/credentials` | `@account_initialization_required`, `@is_admin_or_owner_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/workspace/models.py:342` |
| `GET` | `/console/api/workspaces/current/model-providers/<path:provider>/models/credentials` | `@account_initialization_required`, `@is_admin_or_owner_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/workspace/models.py:342` |
| `POST` | `/console/api/workspaces/current/model-providers/<path:provider>/models/credentials` | `@account_initialization_required`, `@is_admin_or_owner_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/workspace/models.py:342` |
| `PUT` | `/console/api/workspaces/current/model-providers/<path:provider>/models/credentials` | `@account_initialization_required`, `@is_admin_or_owner_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/workspace/models.py:342` |
| `POST` | `/console/api/workspaces/current/model-providers/<path:provider>/models/credentials/switch` | `@account_initialization_required`, `@is_admin_or_owner_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/workspace/models.py:495` |
| `POST` | `/console/api/workspaces/current/model-providers/<path:provider>/models/credentials/validate` | `@account_initialization_required`, `@login_required`, `@setup_required` | `api/controllers/console/workspace/models.py:572` |
| `PATCH` | `/console/api/workspaces/current/model-providers/<path:provider>/models/disable` | `@account_initialization_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/workspace/models.py:541` |
| `PATCH` | `/console/api/workspaces/current/model-providers/<path:provider>/models/enable` | `@account_initialization_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/workspace/models.py:519` |
| `POST` | `/console/api/workspaces/current/model-providers/<path:provider>/models/load-balancing-configs/<string:config_id>/credentials-validate` | `@account_initialization_required`, `@login_required`, `@setup_required` | `api/controllers/console/workspace/load_balancing_config.py:89` |
| `POST` | `/console/api/workspaces/current/model-providers/<path:provider>/models/load-balancing-configs/credentials-validate` | `@account_initialization_required`, `@login_required`, `@setup_required` | `api/controllers/console/workspace/load_balancing_config.py:38` |
| `GET` | `/console/api/workspaces/current/model-providers/<path:provider>/models/parameter-rules` | `@account_initialization_required`, `@login_required`, `@setup_required` | `api/controllers/console/workspace/models.py:610` |
| `POST` | `/console/api/workspaces/current/model-providers/<path:provider>/preferred-provider-type` | `@account_initialization_required`, `@is_admin_or_owner_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/workspace/model_providers.py:368` |
| `GET` | `/console/api/workspaces/current/model-providers/credits` | `@account_initialization_required`, `@login_required`, `@setup_required` | `api/controllers/console/workspace/model_providers.py:185` |
| `GET` | `/console/api/workspaces/current/model-providers/summary` | `@account_initialization_required`, `@login_required`, `@setup_required` | `api/controllers/console/workspace/model_providers.py:166` |
| `GET` | `/console/api/workspaces/current/models/model-types/<string:model_type>` | `@account_initialization_required`, `@login_required`, `@setup_required` | `api/controllers/console/workspace/models.py:633` |
| `GET` | `/console/api/workspaces/current/permission` | `@account_initialization_required`, `@login_required`, `@only_edition_enterprise`, `@setup_required` | `api/controllers/console/workspace/workspace.py:445` |
| `GET` | `/console/api/workspaces/current/plugin/<string:category>/list` | `@account_initialization_required`, `@login_required`, `@setup_required` | `api/controllers/console/workspace/plugin.py:606` |
| `GET` | `/console/api/workspaces/current/plugin/asset` | `@account_initialization_required`, `@login_required`, `@setup_required` | `api/controllers/console/workspace/plugin.py:728` |
| `POST` | `/console/api/workspaces/current/plugin/auto-upgrade/change` | `@account_initialization_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/workspace/plugin.py:1197` |
| `POST` | `/console/api/workspaces/current/plugin/auto-upgrade/exclude` | `@account_initialization_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/workspace/plugin.py:1252` |
| `GET` | `/console/api/workspaces/current/plugin/auto-upgrade/fetch` | `@account_initialization_required`, `@login_required`, `@setup_required` | `api/controllers/console/workspace/plugin.py:1229` |
| `GET` | `/console/api/workspaces/current/plugin/debugging-key` | `@account_initialization_required`, `@login_required`, `@plugin_permission_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/workspace/plugin.py:567` |
| `GET` | `/console/api/workspaces/current/plugin/fetch-manifest` | `@account_initialization_required`, `@login_required`, `@plugin_permission_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/workspace/plugin.py:905` |
| `GET` | `/console/api/workspaces/current/plugin/icon` | `@setup_required` | `api/controllers/console/workspace/plugin.py:711` |
| `POST` | `/console/api/workspaces/current/plugin/install/github` | `@account_initialization_required`, `@login_required`, `@plugin_permission_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/workspace/plugin.py:831` |
| `POST` | `/console/api/workspaces/current/plugin/install/marketplace` | `@account_initialization_required`, `@login_required`, `@plugin_permission_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/workspace/plugin.py:858` |
| `POST` | `/console/api/workspaces/current/plugin/install/pkg` | `@account_initialization_required`, `@login_required`, `@plugin_permission_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/workspace/plugin.py:810` |
| `GET` | `/console/api/workspaces/current/plugin/installed-ids` | `@account_initialization_required`, `@login_required`, `@setup_required` | `api/controllers/console/workspace/plugin.py:656` |
| `GET` | `/console/api/workspaces/current/plugin/list` | `@account_initialization_required`, `@login_required`, `@setup_required` | `api/controllers/console/workspace/plugin.py:587` |
| `POST` | `/console/api/workspaces/current/plugin/list/installations/ids` | `@account_initialization_required`, `@login_required`, `@setup_required` | `api/controllers/console/workspace/plugin.py:692` |
| `POST` | `/console/api/workspaces/current/plugin/list/latest-versions` | `@account_initialization_required`, `@login_required`, `@setup_required` | `api/controllers/console/workspace/plugin.py:674` |
| `GET` | `/console/api/workspaces/current/plugin/marketplace/pkg` | `@account_initialization_required`, `@login_required`, `@plugin_permission_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/workspace/plugin.py:879` |
| `GET` | `/console/api/workspaces/current/plugin/parameters/dynamic-options` | `@account_initialization_required`, `@is_admin_or_owner_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/workspace/plugin.py:1134` |
| `POST` | `/console/api/workspaces/current/plugin/parameters/dynamic-options-with-credentials` | `@account_initialization_required`, `@is_admin_or_owner_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/workspace/plugin.py:1165` |
| `POST` | `/console/api/workspaces/current/plugin/permission/change` | `@account_initialization_required`, `@login_required`, `@setup_required` | `api/controllers/console/workspace/plugin.py:1086` |
| `GET` | `/console/api/workspaces/current/plugin/permission/fetch` | `@account_initialization_required`, `@login_required`, `@setup_required` | `api/controllers/console/workspace/plugin.py:1109` |
| `GET` | `/console/api/workspaces/current/plugin/readme` | `@account_initialization_required`, `@login_required`, `@setup_required` | `api/controllers/console/workspace/plugin.py:1274` |
| `GET` | `/console/api/workspaces/current/plugin/tasks` | `@account_initialization_required`, `@login_required`, `@plugin_permission_required`, `@setup_required` | `api/controllers/console/workspace/plugin.py:930` |
| `GET` | `/console/api/workspaces/current/plugin/tasks/<task_id>` | `@account_initialization_required`, `@login_required`, `@plugin_permission_required`, `@setup_required` | `api/controllers/console/workspace/plugin.py:950` |
| `POST` | `/console/api/workspaces/current/plugin/tasks/<task_id>/delete` | `@account_initialization_required`, `@login_required`, `@plugin_permission_required`, `@setup_required` | `api/controllers/console/workspace/plugin.py:965` |
| `POST` | `/console/api/workspaces/current/plugin/tasks/<task_id>/delete/<path:identifier>` | `@account_initialization_required`, `@login_required`, `@plugin_permission_required`, `@setup_required` | `api/controllers/console/workspace/plugin.py:995` |
| `POST` | `/console/api/workspaces/current/plugin/tasks/delete_all` | `@account_initialization_required`, `@login_required`, `@plugin_permission_required`, `@setup_required` | `api/controllers/console/workspace/plugin.py:980` |
| `POST` | `/console/api/workspaces/current/plugin/uninstall` | `@account_initialization_required`, `@login_required`, `@plugin_permission_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/workspace/plugin.py:1061` |
| `POST` | `/console/api/workspaces/current/plugin/upgrade/github` | `@account_initialization_required`, `@login_required`, `@plugin_permission_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/workspace/plugin.py:1033` |
| `POST` | `/console/api/workspaces/current/plugin/upgrade/marketplace` | `@account_initialization_required`, `@login_required`, `@plugin_permission_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/workspace/plugin.py:1010` |
| `POST` | `/console/api/workspaces/current/plugin/upload/bundle` | `@account_initialization_required`, `@login_required`, `@plugin_permission_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/workspace/plugin.py:790` |
| `POST` | `/console/api/workspaces/current/plugin/upload/github` | `@account_initialization_required`, `@login_required`, `@plugin_permission_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/workspace/plugin.py:767` |
| `POST` | `/console/api/workspaces/current/plugin/upload/pkg` | `@account_initialization_required`, `@login_required`, `@plugin_permission_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/workspace/plugin.py:746` |
| `GET` | `/console/api/workspaces/current/rbac/access-policies` | `@login_required`, `@rbac_permission_required` | `api/controllers/console/workspace/rbac.py:407` |
| `POST` | `/console/api/workspaces/current/rbac/access-policies` | `@login_required`, `@rbac_permission_required` | `api/controllers/console/workspace/rbac.py:407` |
| `DELETE` | `/console/api/workspaces/current/rbac/access-policies/<uuid:policy_id>` | `@login_required`, `@rbac_permission_required` | `api/controllers/console/workspace/rbac.py:446` |
| `GET` | `/console/api/workspaces/current/rbac/access-policies/<uuid:policy_id>` | `@login_required`, `@rbac_permission_required` | `api/controllers/console/workspace/rbac.py:446` |
| `PUT` | `/console/api/workspaces/current/rbac/access-policies/<uuid:policy_id>` | `@login_required`, `@rbac_permission_required` | `api/controllers/console/workspace/rbac.py:446` |
| `POST` | `/console/api/workspaces/current/rbac/access-policies/<uuid:policy_id>/copy` | `@login_required`, `@rbac_permission_required` | `api/controllers/console/workspace/rbac.py:483` |
| `PUT` | `/console/api/workspaces/current/rbac/access-policy-bindings/<uuid:binding_id>/lock` | `@login_required`, `@rbac_permission_required` | `api/controllers/console/workspace/rbac.py:494` |
| `PUT` | `/console/api/workspaces/current/rbac/access-policy-bindings/<uuid:binding_id>/unlock` | `@login_required`, `@rbac_permission_required` | `api/controllers/console/workspace/rbac.py:504` |
| `GET` | `/console/api/workspaces/current/rbac/members/<uuid:member_id>/rbac-roles` | `@login_required` | `api/controllers/console/workspace/rbac.py:924` |
| `PUT` | `/console/api/workspaces/current/rbac/members/<uuid:member_id>/rbac-roles` | `@login_required` | `api/controllers/console/workspace/rbac.py:924` |
| `GET` | `/console/api/workspaces/current/rbac/my-permissions` | `@login_required` | `api/controllers/console/workspace/rbac.py:560` |
| `GET` | `/console/api/workspaces/current/rbac/role-permissions/catalog` | `@login_required` | `api/controllers/console/workspace/rbac.py:280` |
| `GET` | `/console/api/workspaces/current/rbac/roles` | `@login_required`, `@rbac_permission_required` | `api/controllers/console/workspace/rbac.py:309` |
| `POST` | `/console/api/workspaces/current/rbac/roles` | `@login_required`, `@rbac_permission_required` | `api/controllers/console/workspace/rbac.py:309` |
| `DELETE` | `/console/api/workspaces/current/rbac/roles/<uuid:role_id>` | `@login_required`, `@rbac_permission_required` | `api/controllers/console/workspace/rbac.py:345` |
| `GET` | `/console/api/workspaces/current/rbac/roles/<uuid:role_id>` | `@login_required`, `@rbac_permission_required` | `api/controllers/console/workspace/rbac.py:345` |
| `PUT` | `/console/api/workspaces/current/rbac/roles/<uuid:role_id>` | `@login_required`, `@rbac_permission_required` | `api/controllers/console/workspace/rbac.py:345` |
| `POST` | `/console/api/workspaces/current/rbac/roles/<uuid:role_id>/copy` | `@login_required`, `@rbac_permission_required` | `api/controllers/console/workspace/rbac.py:379` |
| `GET` | `/console/api/workspaces/current/rbac/roles/<uuid:role_id>/members` | `@login_required` | `api/controllers/console/workspace/rbac.py:949` |
| `GET` | `/console/api/workspaces/current/skills` | `@console_account_admission`, `@edit_permission_required` | `api/controllers/console/workspace/skills.py:296` |
| `POST` | `/console/api/workspaces/current/skills` | `@console_account_admission`, `@edit_permission_required` | `api/controllers/console/workspace/skills.py:296` |
| `DELETE` | `/console/api/workspaces/current/skills/<string:skill_id>` | `@console_account_admission`, `@edit_permission_required` | `api/controllers/console/workspace/skills.py:412` |
| `GET` | `/console/api/workspaces/current/skills/<string:skill_id>` | `@console_account_admission`, `@edit_permission_required` | `api/controllers/console/workspace/skills.py:412` |
| `PATCH` | `/console/api/workspaces/current/skills/<string:skill_id>` | `@console_account_admission`, `@edit_permission_required` | `api/controllers/console/workspace/skills.py:412` |
| `POST` | `/console/api/workspaces/current/skills/<string:skill_id>/assist/messages` | `@console_account_admission` | `api/controllers/console/workspace/skills.py:516` |
| `POST` | `/console/api/workspaces/current/skills/<string:skill_id>/duplicate` | `@console_account_admission`, `@edit_permission_required` | `api/controllers/console/workspace/skills.py:474` |
| `GET` | `/console/api/workspaces/current/skills/<string:skill_id>/export` | `@console_account_admission` | `api/controllers/console/workspace/skills.py:494` |
| `PATCH` | `/console/api/workspaces/current/skills/<string:skill_id>/files` | `@console_account_admission`, `@edit_permission_required` | `api/controllers/console/workspace/skills.py:568` |
| `PUT` | `/console/api/workspaces/current/skills/<string:skill_id>/files` | `@console_account_admission`, `@edit_permission_required` | `api/controllers/console/workspace/skills.py:568` |
| `POST` | `/console/api/workspaces/current/skills/<string:skill_id>/files/check` | `@console_account_admission`, `@edit_permission_required` | `api/controllers/console/workspace/skills.py:544` |
| `GET` | `/console/api/workspaces/current/skills/<string:skill_id>/files/content` | `@console_account_admission` | `api/controllers/console/workspace/skills.py:644` |
| `GET` | `/console/api/workspaces/current/skills/<string:skill_id>/files/preview` | `@console_account_admission` | `api/controllers/console/workspace/skills.py:615` |
| `POST` | `/console/api/workspaces/current/skills/<string:skill_id>/publish` | `@console_account_admission`, `@edit_permission_required` | `api/controllers/console/workspace/skills.py:678` |
| `GET` | `/console/api/workspaces/current/skills/<string:skill_id>/references` | `@console_account_admission` | `api/controllers/console/workspace/skills.py:728` |
| `POST` | `/console/api/workspaces/current/skills/<string:skill_id>/restore` | `@console_account_admission`, `@edit_permission_required` | `api/controllers/console/workspace/skills.py:703` |
| `GET` | `/console/api/workspaces/current/skills/<string:skill_id>/versions` | `@console_account_admission` | `api/controllers/console/workspace/skills.py:743` |
| `DELETE` | `/console/api/workspaces/current/skills/<string:skill_id>/versions/<string:version_id>` | `@console_account_admission`, `@edit_permission_required` | `api/controllers/console/workspace/skills.py:758` |
| `GET` | `/console/api/workspaces/current/skills/<string:skill_id>/versions/<string:version_id>` | `@console_account_admission`, `@edit_permission_required` | `api/controllers/console/workspace/skills.py:758` |
| `PATCH` | `/console/api/workspaces/current/skills/<string:skill_id>/versions/<string:version_id>` | `@console_account_admission`, `@edit_permission_required` | `api/controllers/console/workspace/skills.py:758` |
| `POST` | `/console/api/workspaces/current/skills/files/upload` | `@console_account_admission`, `@edit_permission_required` | `api/controllers/console/workspace/skills.py:347` |
| `POST` | `/console/api/workspaces/current/skills/import` | `@console_account_admission`, `@edit_permission_required` | `api/controllers/console/workspace/skills.py:385` |
| `GET` | `/console/api/workspaces/current/skills/tags` | `@console_account_admission` | `api/controllers/console/workspace/skills.py:375` |
| `GET` | `/console/api/workspaces/current/summary` | `@account_initialization_required`, `@login_required`, `@setup_required` | `api/controllers/console/workspace/workspace.py:260` |
| `GET` | `/console/api/workspaces/current/tool-labels` | `@account_initialization_required`, `@enterprise_license_required`, `@login_required`, `@setup_required` | `api/controllers/console/workspace/tool_providers.py:1106` |
| `POST` | `/console/api/workspaces/current/tool-provider/api/add` | `@account_initialization_required`, `@is_admin_or_owner_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/workspace/tool_providers.py:685` |
| `POST` | `/console/api/workspaces/current/tool-provider/api/delete` | `@account_initialization_required`, `@is_admin_or_owner_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/workspace/tool_providers.py:796` |
| `GET` | `/console/api/workspaces/current/tool-provider/api/get` | `@account_initialization_required`, `@login_required`, `@setup_required` | `api/controllers/console/workspace/tool_providers.py:819` |
| `GET` | `/console/api/workspaces/current/tool-provider/api/remote` | `@account_initialization_required`, `@login_required`, `@setup_required` | `api/controllers/console/workspace/tool_providers.py:715` |
| `POST` | `/console/api/workspaces/current/tool-provider/api/schema` | `@account_initialization_required`, `@login_required`, `@setup_required` | `api/controllers/console/workspace/tool_providers.py:864` |
| `POST` | `/console/api/workspaces/current/tool-provider/api/test/pre` | `@account_initialization_required`, `@login_required`, `@setup_required` | `api/controllers/console/workspace/tool_providers.py:876` |
| `GET` | `/console/api/workspaces/current/tool-provider/api/tools` | `@account_initialization_required`, `@login_required`, `@setup_required` | `api/controllers/console/workspace/tool_providers.py:741` |
| `POST` | `/console/api/workspaces/current/tool-provider/api/update` | `@account_initialization_required`, `@is_admin_or_owner_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/workspace/tool_providers.py:765` |
| `POST` | `/console/api/workspaces/current/tool-provider/builtin/<path:provider>/add` | `@account_initialization_required`, `@is_admin_or_owner_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/workspace/tool_providers.py:582` |
| `GET` | `/console/api/workspaces/current/tool-provider/builtin/<path:provider>/credential/info` | `@account_initialization_required`, `@login_required`, `@setup_required` | `api/controllers/console/workspace/tool_providers.py:1342` |
| `GET` | `/console/api/workspaces/current/tool-provider/builtin/<path:provider>/credential/schema/<path:credential_type>` | `@account_initialization_required`, `@login_required`, `@setup_required` | `api/controllers/console/workspace/tool_providers.py:843` |
| `GET` | `/console/api/workspaces/current/tool-provider/builtin/<path:provider>/credentials` | `@account_initialization_required`, `@login_required`, `@setup_required` | `api/controllers/console/workspace/tool_providers.py:641` |
| `POST` | `/console/api/workspaces/current/tool-provider/builtin/<path:provider>/default-credential` | `@account_initialization_required`, `@is_admin_or_owner_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/workspace/tool_providers.py:1247` |
| `POST` | `/console/api/workspaces/current/tool-provider/builtin/<path:provider>/delete` | `@account_initialization_required`, `@is_admin_or_owner_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/workspace/tool_providers.py:555` |
| `GET` | `/console/api/workspaces/current/tool-provider/builtin/<path:provider>/icon` | `@setup_required` | `api/controllers/console/workspace/tool_providers.py:674` |
| `GET` | `/console/api/workspaces/current/tool-provider/builtin/<path:provider>/info` | `@account_initialization_required`, `@login_required`, `@setup_required` | `api/controllers/console/workspace/tool_providers.py:537` |
| `GET` | `/console/api/workspaces/current/tool-provider/builtin/<path:provider>/oauth/client-schema` | `@account_initialization_required`, `@login_required`, `@setup_required` | `api/controllers/console/workspace/tool_providers.py:1322` |
| `DELETE` | `/console/api/workspaces/current/tool-provider/builtin/<path:provider>/oauth/custom-client` | `@account_initialization_required`, `@is_admin_or_owner_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/workspace/tool_providers.py:1267` |
| `GET` | `/console/api/workspaces/current/tool-provider/builtin/<path:provider>/oauth/custom-client` | `@account_initialization_required`, `@is_admin_or_owner_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/workspace/tool_providers.py:1267` |
| `POST` | `/console/api/workspaces/current/tool-provider/builtin/<path:provider>/oauth/custom-client` | `@account_initialization_required`, `@is_admin_or_owner_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/workspace/tool_providers.py:1267` |
| `GET` | `/console/api/workspaces/current/tool-provider/builtin/<path:provider>/tools` | `@account_initialization_required`, `@login_required`, `@setup_required` | `api/controllers/console/workspace/tool_providers.py:515` |
| `POST` | `/console/api/workspaces/current/tool-provider/builtin/<path:provider>/update` | `@account_initialization_required`, `@is_admin_or_owner_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/workspace/tool_providers.py:613` |
| `DELETE` | `/console/api/workspaces/current/tool-provider/mcp` | `@account_initialization_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/workspace/tool_providers.py:1373` |
| `POST` | `/console/api/workspaces/current/tool-provider/mcp` | `@account_initialization_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/workspace/tool_providers.py:1373` |
| `PUT` | `/console/api/workspaces/current/tool-provider/mcp` | `@account_initialization_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/workspace/tool_providers.py:1373` |
| `POST` | `/console/api/workspaces/current/tool-provider/mcp/auth` | `@account_initialization_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/workspace/tool_providers.py:1501` |
| `GET` | `/console/api/workspaces/current/tool-provider/mcp/tools/<path:provider_id>` | `@account_initialization_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/workspace/tool_providers.py:1577` |
| `GET` | `/console/api/workspaces/current/tool-provider/mcp/update/<path:provider_id>` | `@account_initialization_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/workspace/tool_providers.py:1611` |
| `POST` | `/console/api/workspaces/current/tool-provider/workflow/create` | `@account_initialization_required`, `@is_admin_or_owner_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/workspace/tool_providers.py:904` |
| `POST` | `/console/api/workspaces/current/tool-provider/workflow/delete` | `@account_initialization_required`, `@is_admin_or_owner_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/workspace/tool_providers.py:964` |
| `GET` | `/console/api/workspaces/current/tool-provider/workflow/get` | `@account_initialization_required`, `@login_required`, `@setup_required` | `api/controllers/console/workspace/tool_providers.py:987` |
| `GET` | `/console/api/workspaces/current/tool-provider/workflow/tools` | `@account_initialization_required`, `@login_required`, `@setup_required` | `api/controllers/console/workspace/tool_providers.py:1019` |
| `POST` | `/console/api/workspaces/current/tool-provider/workflow/update` | `@account_initialization_required`, `@is_admin_or_owner_required`, `@login_required`, `@rbac_permission_required`, `@setup_required` | `api/controllers/console/workspace/tool_providers.py:934` |
| `GET` | `/console/api/workspaces/current/tool-providers` | `@account_initialization_required`, `@login_required`, `@setup_required` | `api/controllers/console/workspace/tool_providers.py:494` |
| `GET` | `/console/api/workspaces/current/tools/api` | `@account_initialization_required`, `@login_required`, `@setup_required` | `api/controllers/console/workspace/tool_providers.py:1065` |
| `GET` | `/console/api/workspaces/current/tools/builtin` | `@account_initialization_required`, `@login_required`, `@setup_required` | `api/controllers/console/workspace/tool_providers.py:1043` |
| `GET` | `/console/api/workspaces/current/tools/mcp` | `@account_initialization_required`, `@login_required`, `@setup_required` | `api/controllers/console/workspace/tool_providers.py:1594` |
| `GET` | `/console/api/workspaces/current/tools/workflow` | `@account_initialization_required`, `@login_required`, `@setup_required` | `api/controllers/console/workspace/tool_providers.py:1084` |
| `GET` | `/console/api/workspaces/custom-config` | `@account_initialization_required`, `@cloud_edition_billing_resource_check`, `@login_required`, `@setup_required` | `api/controllers/console/workspace/workspace.py:317` |
| `POST` | `/console/api/workspaces/custom-config` | `@account_initialization_required`, `@cloud_edition_billing_resource_check`, `@login_required`, `@setup_required` | `api/controllers/console/workspace/workspace.py:317` |
| `POST` | `/console/api/workspaces/custom-config/webapp-logo/upload` | `@account_initialization_required`, `@cloud_edition_billing_resource_check`, `@login_required`, `@setup_required` | `api/controllers/console/workspace/workspace.py:376` |
| `POST` | `/console/api/workspaces/info` | `@account_initialization_required`, `@login_required`, `@setup_required` | `api/controllers/console/workspace/workspace.py:418` |
| `POST` | `/console/api/workspaces/switch` | `@account_initialization_required`, `@login_required`, `@setup_required` | `api/controllers/console/workspace/workspace.py:289` |

## Events

None. No message channel is produced or consumed by this feature's own modules [D: api/controllers/]. Asynchronous work it starts is dispatched as Celery tasks under `api/tasks/`, which is a job queue rather than a published event contract.

## Error model

Errors are raised as Flask-RESTX `HTTPException` subclasses declared per controller package and rendered by the shared handler [D: api/controllers/console/__init__.py:10].

OPEN: is the `{code, message, status}` body a stable public contract, or an implementation detail? Nothing in the repository states which error codes callers may branch on.

## Versioning and compatibility

The Service API is versioned in its mount prefix, `/v1` [D: api/controllers/service_api/__init__.py:6]. The Console API carries no version segment [D: api/controllers/console/__init__.py:10].

I: the Console API is treated as internal to the first-party web client and free to change — basis: it is unversioned while every externally-consumed surface (`/v1`, `/openapi/v1`) carries a version [D: api/controllers/console/__init__.py:10].

OPEN: what is the deprecation window for a `/v1` endpoint? No policy is stated anywhere in the tree.

## Spec files

The repository generates its own OpenAPI documents; those are authoritative for request and response shapes, and this document does not restate them:

- `api/dev/generate_swagger_specs.py` — generator [D: api/dev/generate_swagger_specs.py:1]
- `api/openapi/markdown/{console,service,web,openapi}-openapi.md` — rendered contract [D: api/openapi/markdown/]
- `packages/contracts/generated/api/{console,service,web,openapi}/*.gen.ts` — generated TypeScript types, Zod schemas and oRPC clients [D: packages/contracts/generated/]

Entity shapes are `$ref`s into `schema/schemas.json`; `schema/openapi_v1.17_F-005.json` and `schema/asyncapi_v1.17_F-005.json` remain scaffold stubs — see the open question below.

OPEN: should `schema/openapi_v1.17_F-005.json` be filled by hand, or replaced by a pointer to the generated spec? Maintaining a second copy guarantees drift.

## Traceability

Stories in `PRDs/prd_v1.17_F-005-*.md`; test cases in `tests/test_v1.17_F-005.md`.

OPEN: no endpoint in this repository is annotated with the requirement it serves, so the mapping below the story level is inferred from naming alone.
