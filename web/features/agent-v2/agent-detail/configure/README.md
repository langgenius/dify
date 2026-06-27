# Agent Configure

Owns the Agent V2 configure runtime used by the Agent App configure page and workflow inline Agent configure surface, including editable composer draft wiring, build chat sessions, version viewing, build draft mode, and preview side panels.

## Internal Modules

- agent-composer
- agent-detail/configure/state
- agent-detail/configure/use-agent-build-draft-run
- agent-detail/configure/use-agent-configure-build-draft
- agent-detail/configure/use-agent-configure-sync
- agent-detail/configure/components/orchestrate
- agent-detail/configure/components/preview
- agent-detail/configure/components/workspace

## External Modules

- app/components/base/chat
- app/components/base/action-button
- app/components/base/app-icon
- app/components/base/features
- app/components/base/file-uploader
- app/components/base/infotip
- app/components/base/loading
- app/components/base/prompt-editor
- app/components/base/skeleton
- app/components/app/configuration/config/agent/agent-tools
- app/components/datasets
- app/components/header/account-setting/model-provider-page
- app/components/plugins
- app/components/tools
- app/components/workflow/block-icon
- app/components/workflow/block-selector
- app/components/workflow/hooks/use-serial-async-callback
- app/components/workflow/nodes
- app/components/workflow/types
- config
- context/app-context
- context/i18n
- context/modal-context
- contract/router
- hooks/use-format-time-from-now
- hooks/use-theme
- hooks/use-timestamp
- models/datasets
- models/debug
- models/log
- service/base
- service/use-common
- types/app
- types/common
- types/i18n
- types/workflow
- utils/format
- utils/var
