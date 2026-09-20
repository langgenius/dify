---
title: API Contract v1.17 F-006 — Published App Surfaces
id: F-006
status: draft
owner: TBD
updated: 2026-09-20
---

# API Contract v1.17 F-006 — Published App Surfaces

> As-built. Paths are composed: Blueprint `url_prefix` + the literal in the route decorator.

## Surface summary

152 operations over 143 paths [D: api/controllers/].

- 42 on the Console API (browser session, `/console/api`) [D: api/controllers/console/__init__.py]
- 36 on the Web App API (passport token, `/api`) [D: api/controllers/web/__init__.py]
- 33 on the Public OAuth API (scopes, `/openapi/v1`) [D: api/controllers/openapi/__init__.py]
- 30 on the Service API (API key, `/v1`) [D: api/controllers/service_api/__init__.py]
- 10 on the File delivery (`/files`) [D: api/controllers/files/__init__.py]
- 1 on the MCP server (`/mcp`) [D: api/controllers/mcp/__init__.py]

140 of these carry at least one guard decorator; 12 carry none [D: api/controllers/].

This feature deliberately exposes no other surface: the table below is the complete set of routes whose handler files belong to it.

## Endpoints

| Method | Path | Auth guards | Handler |
| --- | --- | --- | --- |
| `POST` | `/api/audio-to-text` | `@base:WebApiResource (web app passport)` | `api/controllers/web/audio.py:62` |
| `POST` | `/api/chat-messages` | `@base:WebApiResource (web app passport)` | `api/controllers/web/completion.py:191` |
| `POST` | `/api/chat-messages/<string:task_id>/stop` | `@base:WebApiResource (web app passport)` | `api/controllers/web/completion.py:266` |
| `POST` | `/api/completion-messages` | `@base:WebApiResource (web app passport)` | `api/controllers/web/completion.py:98` |
| `POST` | `/api/completion-messages/<string:task_id>/stop` | `@base:WebApiResource (web app passport)` | `api/controllers/web/completion.py:161` |
| `GET` | `/api/conversations` | `@base:WebApiResource (web app passport)` | `api/controllers/web/conversation.py:48` |
| `DELETE` | `/api/conversations/<uuid:c_id>` | `@base:WebApiResource (web app passport)` | `api/controllers/web/conversation.py:101` |
| `POST` | `/api/conversations/<uuid:c_id>/name` | `@base:WebApiResource (web app passport)` | `api/controllers/web/conversation.py:129` |
| `PATCH` | `/api/conversations/<uuid:c_id>/pin` | `@base:WebApiResource (web app passport)` | `api/controllers/web/conversation.py:179` |
| `PATCH` | `/api/conversations/<uuid:c_id>/unpin` | `@base:WebApiResource (web app passport)` | `api/controllers/web/conversation.py:210` |
| `POST` | `/api/email-code-login` | `@only_edition_enterprise`, `@setup_required` | `api/controllers/web/login.py:196` |
| `POST` | `/api/email-code-login/validity` | `@decrypt_code_field`, `@only_edition_enterprise`, `@setup_required` | `api/controllers/web/login.py:225` |
| `POST` | `/api/files/upload` | `@base:WebApiResource (web app passport)` | `api/controllers/web/files.py:23` |
| `POST` | `/api/forgot-password` | `@email_password_login_enabled`, `@only_edition_enterprise`, `@setup_required` | `api/controllers/web/forgot_password.py:45` |
| `POST` | `/api/forgot-password/resets` | `@email_password_login_enabled`, `@only_edition_enterprise`, `@setup_required` | `api/controllers/web/forgot_password.py:133` |
| `POST` | `/api/forgot-password/validity` | `@email_password_login_enabled`, `@only_edition_enterprise`, `@setup_required` | `api/controllers/web/forgot_password.py:85` |
| `POST` | `/api/login` | `@decrypt_password_field`, `@only_edition_enterprise`, `@setup_required` | `api/controllers/web/login.py:85` |
| `GET` | `/api/login/status` | `@setup_required` | `api/controllers/web/login.py:131` |
| `POST` | `/api/logout` | `@setup_required` | `api/controllers/web/login.py:176` |
| `GET` | `/api/messages` | `@base:WebApiResource (web app passport)` | `api/controllers/web/message.py:64` |
| `POST` | `/api/messages/<uuid:message_id>/feedbacks` | `@base:WebApiResource (web app passport)` | `api/controllers/web/message.py:107` |
| `GET` | `/api/messages/<uuid:message_id>/more-like-this` | `@base:WebApiResource (web app passport)` | `api/controllers/web/message.py:154` |
| `GET` | `/api/messages/<uuid:message_id>/suggested-questions` | `@base:WebApiResource (web app passport)` | `api/controllers/web/message.py:218` |
| `GET` | `/api/meta` | `@base:WebApiResource (web app passport)` | `api/controllers/web/app.py:98` |
| `GET` | `/api/parameters` | `@base:WebApiResource (web app passport)` | `api/controllers/web/app.py:69` |
| `GET` | `/api/passport` | public / token-in-URL | `api/controllers/web/passport.py:37` |
| `GET` | `/api/remote-files/<path:url>` | `@base:WebApiResource (web app passport)` | `api/controllers/web/remote_files.py:46` |
| `POST` | `/api/remote-files/upload` | `@base:WebApiResource (web app passport)` | `api/controllers/web/remote_files.py:102` |
| `GET` | `/api/saved-messages` | `@base:WebApiResource (web app passport)` | `api/controllers/web/saved_message.py:24` |
| `POST` | `/api/saved-messages` | `@base:WebApiResource (web app passport)` | `api/controllers/web/saved_message.py:24` |
| `DELETE` | `/api/saved-messages/<uuid:message_id>` | `@base:WebApiResource (web app passport)` | `api/controllers/web/saved_message.py:91` |
| `GET` | `/api/site` | `@base:WebApiResource (web app passport)` | `api/controllers/web/site.py:128` |
| `GET` | `/api/system-features` | public / token-in-URL | `api/controllers/web/feature.py:12` |
| `POST` | `/api/text-to-audio` | `@base:WebApiResource (web app passport)` | `api/controllers/web/audio.py:119` |
| `GET` | `/api/webapp/access-mode` | public / token-in-URL | `api/controllers/web/app.py:123` |
| `GET` | `/api/webapp/permission` | public / token-in-URL | `api/controllers/web/app.py:154` |
| `GET` | `/console/api/explore/apps` | `@console_account_admission` | `api/controllers/console/explore/recommended_app.py:96` |
| `GET` | `/console/api/explore/apps/<uuid:app_id>` | `@console_account_admission` | `api/controllers/console/explore/recommended_app.py:126` |
| `GET` | `/console/api/explore/apps/learn-dify` | `@console_account_admission` | `api/controllers/console/explore/recommended_app.py:111` |
| `ANY` | `/console/api/explore/banners` | public / token-in-URL | `api/controllers/console/explore/banner.py:71` |
| `GET` | `/console/api/installed-apps` | `@account_initialization_required`, `@cloud_edition_billing_resource_check`, `@login_required` | `api/controllers/console/explore/installed_app.py:148` |
| `POST` | `/console/api/installed-apps` | `@account_initialization_required`, `@cloud_edition_billing_resource_check`, `@login_required` | `api/controllers/console/explore/installed_app.py:148` |
| `DELETE` | `/console/api/installed-apps/<uuid:installed_app_id>` | `@base:InstalledAppResource (console session)` | `api/controllers/console/explore/installed_app.py:238` |
| `GET` | `/console/api/installed-apps/<uuid:installed_app_id>` | `@base:InstalledAppResource (console session)` | `api/controllers/console/explore/installed_app.py:238` |
| `PATCH` | `/console/api/installed-apps/<uuid:installed_app_id>` | `@base:InstalledAppResource (console session)` | `api/controllers/console/explore/installed_app.py:238` |
| `POST` | `/console/api/installed-apps/<uuid:installed_app_id>/audio-to-text` | `@base:InstalledAppResource (console session)` | `api/controllers/console/explore/audio.py:47` |
| `POST` | `/console/api/installed-apps/<uuid:installed_app_id>/chat-messages` | `@base:InstalledAppResource (console session)` | `api/controllers/console/explore/completion.py:173` |
| `POST` | `/console/api/installed-apps/<uuid:installed_app_id>/chat-messages/<string:task_id>/stop` | `@base:InstalledAppResource (console session)` | `api/controllers/console/explore/completion.py:243` |
| `POST` | `/console/api/installed-apps/<uuid:installed_app_id>/completion-messages` | `@base:InstalledAppResource (console session)` | `api/controllers/console/explore/completion.py:83` |
| `POST` | `/console/api/installed-apps/<uuid:installed_app_id>/completion-messages/<string:task_id>/stop` | `@base:InstalledAppResource (console session)` | `api/controllers/console/explore/completion.py:148` |
| `GET` | `/console/api/installed-apps/<uuid:installed_app_id>/conversations` | `@base:InstalledAppResource (console session)` | `api/controllers/console/explore/conversation.py:48` |
| `DELETE` | `/console/api/installed-apps/<uuid:installed_app_id>/conversations/<uuid:c_id>` | `@base:InstalledAppResource (console session)` | `api/controllers/console/explore/conversation.py:104` |
| `POST` | `/console/api/installed-apps/<uuid:installed_app_id>/conversations/<uuid:c_id>/name` | `@base:InstalledAppResource (console session)` | `api/controllers/console/explore/conversation.py:128` |
| `PATCH` | `/console/api/installed-apps/<uuid:installed_app_id>/conversations/<uuid:c_id>/pin` | `@base:InstalledAppResource (console session)` | `api/controllers/console/explore/conversation.py:161` |
| `PATCH` | `/console/api/installed-apps/<uuid:installed_app_id>/conversations/<uuid:c_id>/unpin` | `@base:InstalledAppResource (console session)` | `api/controllers/console/explore/conversation.py:186` |
| `GET` | `/console/api/installed-apps/<uuid:installed_app_id>/messages` | `@base:InstalledAppResource (console session)` | `api/controllers/console/explore/message.py:70` |
| `POST` | `/console/api/installed-apps/<uuid:installed_app_id>/messages/<uuid:message_id>/feedbacks` | `@base:InstalledAppResource (console session)` | `api/controllers/console/explore/message.py:114` |
| `GET` | `/console/api/installed-apps/<uuid:installed_app_id>/messages/<uuid:message_id>/more-like-this` | `@base:InstalledAppResource (console session)` | `api/controllers/console/explore/message.py:147` |
| `GET` | `/console/api/installed-apps/<uuid:installed_app_id>/messages/<uuid:message_id>/suggested-questions` | `@base:InstalledAppResource (console session)` | `api/controllers/console/explore/message.py:199` |
| `GET` | `/console/api/installed-apps/<uuid:installed_app_id>/meta` | `@base:InstalledAppResource (console session)` | `api/controllers/console/explore/parameter.py:43` |
| `GET` | `/console/api/installed-apps/<uuid:installed_app_id>/parameters` | `@base:InstalledAppResource (console session)` | `api/controllers/console/explore/parameter.py:28` |
| `GET` | `/console/api/installed-apps/<uuid:installed_app_id>/saved-messages` | `@base:InstalledAppResource (console session)` | `api/controllers/console/explore/saved_message.py:25` |
| `POST` | `/console/api/installed-apps/<uuid:installed_app_id>/saved-messages` | `@base:InstalledAppResource (console session)` | `api/controllers/console/explore/saved_message.py:25` |
| `DELETE` | `/console/api/installed-apps/<uuid:installed_app_id>/saved-messages/<uuid:message_id>` | `@base:InstalledAppResource (console session)` | `api/controllers/console/explore/saved_message.py:76` |
| `POST` | `/console/api/installed-apps/<uuid:installed_app_id>/text-to-audio` | `@base:InstalledAppResource (console session)` | `api/controllers/console/explore/audio.py:97` |
| `ANY` | `/console/api/trial-apps/<uuid:app_id>` | `@get_previewable_app_model` | `api/controllers/console/explore/trial.py:956` |
| `ANY` | `/console/api/trial-apps/<uuid:app_id>/audio-to-text` | `@base:TrialAppResource (console session)` | `api/controllers/console/explore/trial.py:945` |
| `ANY` | `/console/api/trial-apps/<uuid:app_id>/chat-messages` | `@base:TrialAppResource (console session)` | `api/controllers/console/explore/trial.py:925` |
| `ANY` | `/console/api/trial-apps/<uuid:app_id>/completion-messages` | `@base:TrialAppResource (console session)` | `api/controllers/console/explore/trial.py:948` |
| `ANY` | `/console/api/trial-apps/<uuid:app_id>/files/upload` | `@base:TrialAppResource (console session)`, `@cloud_edition_billing_resource_check` | `api/controllers/console/explore/trial.py:927` |
| `ANY` | `/console/api/trial-apps/<uuid:app_id>/messages/<uuid:message_id>/suggested-questions` | `@base:TrialAppResource (console session)` | `api/controllers/console/explore/trial.py:939` |
| `ANY` | `/console/api/trial-apps/<uuid:app_id>/parameters` | `@get_previewable_app_model` | `api/controllers/console/explore/trial.py:954` |
| `ANY` | `/console/api/trial-apps/<uuid:app_id>/remote-files/upload` | `@base:TrialAppResource (console session)`, `@cloud_edition_billing_resource_check` | `api/controllers/console/explore/trial.py:933` |
| `ANY` | `/console/api/trial-apps/<uuid:app_id>/site` | `@get_previewable_app_model` | `api/controllers/console/explore/trial.py:952` |
| `ANY` | `/console/api/trial-apps/<uuid:app_id>/text-to-audio` | `@base:TrialAppResource (console session)` | `api/controllers/console/explore/trial.py:946` |
| `ANY` | `/console/api/trial-apps/<uuid:app_id>/workflows` | `@get_previewable_app_model` | `api/controllers/console/explore/trial.py:963` |
| `ANY` | `/console/api/trial-apps/<uuid:app_id>/workflows/run` | `@base:TrialAppResource (console session)` | `api/controllers/console/explore/trial.py:958` |
| `ANY` | `/console/api/trial-apps/<uuid:app_id>/workflows/tasks/<string:task_id>/stop` | `@base:TrialAppResource (console session)` | `api/controllers/console/explore/trial.py:961` |
| `GET` | `/files/<uuid:file_id>/file-preview` | `@staticmethod` | `api/controllers/files/upload_file_delivery.py:100` |
| `GET` | `/files/<uuid:file_id>/image-preview` | public / token-in-URL | `api/controllers/files/upload_file_delivery.py:63` |
| `GET` | `/files/appdeploy/<uuid:file_id>/content` | public / token-in-URL | `api/controllers/files/appdeploy_files.py:269` |
| `POST` | `/files/appdeploy/produced` | `@file_grant_required` | `api/controllers/files/appdeploy_files.py:191` |
| `POST` | `/files/appdeploy/remote-upload` | `@file_grant_required` | `api/controllers/files/appdeploy_files.py:149` |
| `POST` | `/files/appdeploy/resolve` | `@file_grant_required` | `api/controllers/files/appdeploy_files.py:231` |
| `POST` | `/files/appdeploy/upload` | `@file_grant_required` | `api/controllers/files/appdeploy_files.py:121` |
| `GET` | `/files/tools/<uuid:file_id>.<string:extension>` | public / token-in-URL | `api/controllers/files/tool_files.py:30` |
| `POST` | `/files/upload/for-plugin` | `@setup_required` | `api/controllers/files/plugin_file_upload.py:65` |
| `GET` | `/files/workspaces/<uuid:workspace_id>/webapp-logo` | public / token-in-URL | `api/controllers/files/upload_file_delivery.py:157` |
| `POST` | `/mcp/server/<string:server_code>/mcp` | public / token-in-URL | `api/controllers/mcp/mcp.py:44` |
| `GET` | `/openapi/v1/_health` | `@returns` | `api/controllers/openapi/index.py:11` |
| `GET` | `/openapi/v1/_version` | `@returns` | `api/controllers/openapi/index.py:18` |
| `GET` | `/openapi/v1/account` | `@endpoint` | `api/controllers/openapi/account.py:34` |
| `GET` | `/openapi/v1/account/sessions` | `@endpoint` | `api/controllers/openapi/account.py:68` |
| `DELETE` | `/openapi/v1/account/sessions/<string:session_id>` | `@endpoint` | `api/controllers/openapi/account.py:90` |
| `DELETE` | `/openapi/v1/account/sessions/self` | `@endpoint` | `api/controllers/openapi/account.py:57` |
| `GET` | `/openapi/v1/apps` | `@endpoint` | `api/controllers/openapi/apps.py:121` |
| `GET` | `/openapi/v1/apps/<string:app_id>` | `@endpoint` | `api/controllers/openapi/apps.py:103` |
| `GET` | `/openapi/v1/apps/<string:app_id>/dependencies:check` | `@endpoint` | `api/controllers/openapi/app_dsl.py:172` |
| `GET` | `/openapi/v1/apps/<string:app_id>/dsl` | `@endpoint` | `api/controllers/openapi/app_dsl.py:134` |
| `POST` | `/openapi/v1/apps/<string:app_id>/files` | `@endpoint` | `api/controllers/openapi/files.py:34` |
| `POST` | `/openapi/v1/apps/<string:app_id>/tasks/<string:task_id>:stop` | `@endpoint` | `api/controllers/openapi/app_run.py:196` |
| `POST` | `/openapi/v1/apps/<string:app_id>:run` | `@endpoint` | `api/controllers/openapi/app_run.py:154` |
| `GET` | `/openapi/v1/oauth/device/approval-context` | `@enterprise_only` | `api/controllers/openapi/oauth_device_sso.py:218` |
| `POST` | `/openapi/v1/oauth/device/approve` | `@account_initialization_required`, `@bearer_feature_required`, `@login_required`, `@rate_limit`, `@setup_required` | `api/controllers/openapi/oauth_device.py:206` |
| `POST` | `/openapi/v1/oauth/device/approve-external` | `@enterprise_only` | `api/controllers/openapi/oauth_device_sso.py:243` |
| `POST` | `/openapi/v1/oauth/device/code` | `@rate_limit` | `api/controllers/openapi/oauth_device.py:102` |
| `POST` | `/openapi/v1/oauth/device/deny` | `@account_initialization_required`, `@bearer_feature_required`, `@login_required`, `@rate_limit`, `@setup_required` | `api/controllers/openapi/oauth_device.py:274` |
| `GET` | `/openapi/v1/oauth/device/lookup` | `@rate_limit` | `api/controllers/openapi/oauth_device.py:168` |
| `GET` | `/openapi/v1/oauth/device/sso-complete` | `@enterprise_only` | `api/controllers/openapi/oauth_device_sso.py:150` |
| `GET` | `/openapi/v1/oauth/device/sso-initiate` | `@enterprise_only`, `@rate_limit` | `api/controllers/openapi/oauth_device_sso.py:101` |
| `POST` | `/openapi/v1/oauth/device/token` | public / token-in-URL | `api/controllers/openapi/oauth_device.py:128` |
| `GET` | `/openapi/v1/permitted-external-apps` | `@endpoint` | `api/controllers/openapi/apps_permitted_external.py:41` |
| `GET` | `/openapi/v1/permitted-external-apps/<string:app_id>` | `@endpoint` | `api/controllers/openapi/apps_permitted_external.py:95` |
| `GET` | `/openapi/v1/workspaces` | `@endpoint` | `api/controllers/openapi/workspaces.py:88` |
| `GET` | `/openapi/v1/workspaces/<string:workspace_id>` | `@endpoint` | `api/controllers/openapi/workspaces.py:100` |
| `POST` | `/openapi/v1/workspaces/<string:workspace_id>/apps/imports` | `@endpoint` | `api/controllers/openapi/app_dsl.py:30` |
| `POST` | `/openapi/v1/workspaces/<string:workspace_id>/apps/imports/<string:import_id>:confirm` | `@endpoint` | `api/controllers/openapi/app_dsl.py:93` |
| `GET` | `/openapi/v1/workspaces/<string:workspace_id>/members` | `@endpoint` | `api/controllers/openapi/workspaces.py:145` |
| `POST` | `/openapi/v1/workspaces/<string:workspace_id>/members` | `@endpoint` | `api/controllers/openapi/workspaces.py:145` |
| `DELETE` | `/openapi/v1/workspaces/<string:workspace_id>/members/<string:member_id>` | `@endpoint` | `api/controllers/openapi/workspaces.py:224` |
| `PATCH` | `/openapi/v1/workspaces/<string:workspace_id>/members/<string:member_id>` | `@endpoint` | `api/controllers/openapi/workspaces.py:224` |
| `POST` | `/openapi/v1/workspaces/<string:workspace_id>:switch` | `@endpoint` | `api/controllers/openapi/workspaces.py:115` |
| `GET` | `/v1/` | public / token-in-URL | `api/controllers/service_api/index.py:18` |
| `GET` | `/v1/app/feedbacks` | `@validate_app_token` | `api/controllers/service_api/app/message.py:186` |
| `POST` | `/v1/apps/annotation-reply/<string:action>` | `@validate_app_token` | `api/controllers/service_api/app/annotation.py:79` |
| `GET` | `/v1/apps/annotation-reply/<string:action>/status/<uuid:job_id>` | `@validate_app_token` | `api/controllers/service_api/app/annotation.py:125` |
| `GET` | `/v1/apps/annotations` | `@validate_app_token` | `api/controllers/service_api/app/annotation.py:183` |
| `POST` | `/v1/apps/annotations` | `@validate_app_token` | `api/controllers/service_api/app/annotation.py:183` |
| `DELETE` | `/v1/apps/annotations/<uuid:annotation_id>` | `@edit_permission_required`, `@validate_app_token` | `api/controllers/service_api/app/annotation.py:261` |
| `PUT` | `/v1/apps/annotations/<uuid:annotation_id>` | `@edit_permission_required`, `@validate_app_token` | `api/controllers/service_api/app/annotation.py:261` |
| `POST` | `/v1/audio-to-text` | `@validate_app_token` | `api/controllers/service_api/app/audio.py:48` |
| `POST` | `/v1/chat-messages` | `@expect_with_user`, `@json_or_event_stream_response`, `@validate_app_token` | `api/controllers/service_api/app/completion.py:324` |
| `POST` | `/v1/chat-messages/<string:task_id>/stop` | `@expect_user_json`, `@validate_app_token` | `api/controllers/service_api/app/completion.py:467` |
| `POST` | `/v1/completion-messages` | `@expect_with_user`, `@json_or_event_stream_response`, `@validate_app_token` | `api/controllers/service_api/app/completion.py:175` |
| `POST` | `/v1/completion-messages/<string:task_id>/stop` | `@expect_user_json`, `@validate_app_token` | `api/controllers/service_api/app/completion.py:281` |
| `GET` | `/v1/conversations` | `@validate_app_token` | `api/controllers/service_api/app/conversation.py:159` |
| `DELETE` | `/v1/conversations/<uuid:conversation_id>` | `@expect_user_json`, `@validate_app_token` | `api/controllers/service_api/app/conversation.py:225` |
| `POST` | `/v1/conversations/<uuid:conversation_id>/name` | `@expect_with_user`, `@validate_app_token` | `api/controllers/service_api/app/conversation.py:264` |
| `GET` | `/v1/conversations/<uuid:conversation_id>/variables` | `@validate_app_token` | `api/controllers/service_api/app/conversation.py:315` |
| `PUT` | `/v1/conversations/<uuid:conversation_id>/variables/<uuid:variable_id>` | `@expect_with_user`, `@validate_app_token` | `api/controllers/service_api/app/conversation.py:375` |
| `GET` | `/v1/end-users/<uuid:end_user_id>` | `@validate_app_token` | `api/controllers/service_api/end_user/end_user.py:16` |
| `GET` | `/v1/files/<uuid:file_id>/preview` | `@binary_response`, `@validate_app_token` | `api/controllers/service_api/app/file_preview.py:55` |
| `POST` | `/v1/files/upload` | `@validate_app_token` | `api/controllers/service_api/app/file.py:26` |
| `GET` | `/v1/info` | `@validate_app_token` | `api/controllers/service_api/app/app.py:116` |
| `GET` | `/v1/messages` | `@validate_app_token` | `api/controllers/service_api/app/message.py:72` |
| `POST` | `/v1/messages/<uuid:message_id>/feedbacks` | `@expect_with_user`, `@validate_app_token` | `api/controllers/service_api/app/message.py:136` |
| `GET` | `/v1/messages/<uuid:message_id>/suggested` | `@validate_app_token` | `api/controllers/service_api/app/message.py:226` |
| `GET` | `/v1/meta` | `@validate_app_token` | `api/controllers/service_api/app/app.py:82` |
| `GET` | `/v1/parameters` | `@validate_app_token` | `api/controllers/service_api/app/app.py:41` |
| `GET` | `/v1/site` | `@validate_app_token` | `api/controllers/service_api/app/site.py:16` |
| `POST` | `/v1/text-to-audio` | `@binary_response`, `@expect_with_user`, `@validate_app_token` | `api/controllers/service_api/app/audio.py:148` |
| `GET` | `/v1/workspaces/current/models/model-types/<string:model_type>` | `@validate_dataset_token` | `api/controllers/service_api/workspace/models.py:26` |

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

Entity shapes are `$ref`s into `schema/schemas.json`; `schema/openapi_v1.17_F-006.json` and `schema/asyncapi_v1.17_F-006.json` remain scaffold stubs — see the open question below.

OPEN: should `schema/openapi_v1.17_F-006.json` be filled by hand, or replaced by a pointer to the generated spec? Maintaining a second copy guarantees drift.

## Traceability

Stories in `PRDs/prd_v1.17_F-006-*.md`; test cases in `tests/test_v1.17_F-006.md`.

OPEN: no endpoint in this repository is annotated with the requirement it serves, so the mapping below the story level is inferred from naming alone.
