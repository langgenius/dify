'use client'

import type { ToolSettingTarget } from '../types'
import type { AgentProviderTool, AgentToolAction } from '@/features/agent-v2/agent-composer/form-state'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  CollapsiblePanel,
  CollapsibleRoot,
  CollapsibleTrigger,
} from '@langgenius/dify-ui/collapsible'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { StatusDot } from '@langgenius/dify-ui/status-dot'
import { memo, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AuthCategory,
} from '@/app/components/plugins/plugin-auth'
import AddOAuthButton from '@/app/components/plugins/plugin-auth/authorize/add-oauth-button'
import ApiKeyModal from '@/app/components/plugins/plugin-auth/authorize/api-key-modal'
import AuthorizedInNode from '@/app/components/plugins/plugin-auth/authorized-in-node'
import { useInvalidPluginCredentialInfoHook } from '@/app/components/plugins/plugin-auth/hooks/use-credential'
import { CollectionType } from '@/app/components/tools/types'
import BlockIcon from '@/app/components/workflow/block-icon'
import { BlockEnum } from '@/app/components/workflow/types'
import useTheme from '@/hooks/use-theme'
import { Theme } from '@/types/app'
import { useAgentOrchestrateReadOnly } from '../../read-only-context'

function ProviderIcon({
  icon,
  iconClassName,
}: {
  icon?: AgentProviderTool['icon']
  iconClassName: string
}) {
  if (icon) {
    return (
      <BlockIcon
        className="shrink-0"
        type={BlockEnum.Tool}
        toolIcon={icon}
      />
    )
  }

  return (
    <span className="flex size-5 shrink-0 items-center justify-center rounded-md border-[0.5px] border-effects-icon-border bg-background-default-dodge">
      <span aria-hidden className={cn('size-3.5', iconClassName)} />
    </span>
  )
}

function UnauthorizedCredentialStatus({
  tool,
  onCredentialChange,
}: {
  tool: AgentProviderTool
  onCredentialChange: (credentialId?: string, credentialType?: AgentProviderTool['credentialType']) => void
}) {
  const { t } = useTranslation()
  const [isApiKeyModalOpen, setIsApiKeyModalOpen] = useState(false)
  const pluginPayload = useMemo(() => ({
    provider: tool.id,
    category: AuthCategory.tool,
    providerType: tool.providerType ?? CollectionType.builtIn,
  }), [tool.id, tool.providerType])
  const invalidPluginCredentialInfo = useInvalidPluginCredentialInfoHook(pluginPayload)
  const handleApiKeyModalOpen = useCallback(() => {
    setIsApiKeyModalOpen(true)
  }, [])
  const handleApiKeyModalClose = useCallback(() => {
    setIsApiKeyModalOpen(false)
  }, [])
  const handleCredentialUpdate = useCallback(() => {
    invalidPluginCredentialInfo()
    onCredentialChange(undefined, tool.credentialType)
  }, [invalidPluginCredentialInfo, onCredentialChange, tool.credentialType])

  if (tool.credentialType === 'oauth2') {
    return (
      <AddOAuthButton
        pluginPayload={pluginPayload}
        onUpdate={handleCredentialUpdate}
        renderTrigger={({ disabled, onClick }) => (
          <Button
            variant="secondary"
            size="small"
            className="shrink-0"
            disabled={disabled}
            onClick={onClick}
          >
            {t($ => $['notAuthorized'], { ns: 'tools' })}
            <StatusDot className="ml-2" status="warning" />
          </Button>
        )}
      />
    )
  }

  return (
    <>
      <Button
        variant="secondary"
        size="small"
        className="shrink-0"
        onClick={handleApiKeyModalOpen}
      >
        {t($ => $['notAuthorized'], { ns: 'tools' })}
        <StatusDot className="ml-2" status="warning" />
      </Button>
      <ApiKeyModal
        pluginPayload={pluginPayload}
        open={isApiKeyModalOpen}
        onOpenChange={setIsApiKeyModalOpen}
        onClose={handleApiKeyModalClose}
        onUpdate={handleCredentialUpdate}
      />
    </>
  )
}

function CredentialStatus({
  tool,
  onCredentialChange,
}: {
  tool: AgentProviderTool
  onCredentialChange: (credentialId?: string, credentialType?: AgentProviderTool['credentialType']) => void
}) {
  const canSwitchCredential = (tool.providerType ?? CollectionType.builtIn) === CollectionType.builtIn && tool.allowDelete
  const handleAuthorizationItemClick = useCallback((id: string) => {
    onCredentialChange(id === '__workspace_default__' ? undefined : id || undefined, tool.credentialType)
  }, [onCredentialChange, tool.credentialType])
  const handleDefaultCredentialChange = useCallback((id?: string) => {
    if (!tool.credentialId && id)
      onCredentialChange(id, tool.credentialType)
  }, [onCredentialChange, tool.credentialId, tool.credentialType])

  if (tool.credentialVariant === 'none')
    return null

  if (tool.credentialVariant === 'unauthorized') {
    return (
      <UnauthorizedCredentialStatus
        tool={tool}
        onCredentialChange={onCredentialChange}
      />
    )
  }

  if (!canSwitchCredential)
    return null

  return (
    <div className="shrink-0">
      <AuthorizedInNode
        pluginPayload={{
          provider: tool.id,
          category: AuthCategory.tool,
          providerType: tool.providerType ?? CollectionType.builtIn,
        }}
        credentialId={tool.credentialId}
        onAuthorizationItemClick={handleAuthorizationItemClick}
        onDefaultCredentialChange={handleDefaultCredentialChange}
      />
    </div>
  )
}

const ProviderToolActionItem = memo(({
  action,
  tool,
  onConfigureAction,
  onRemoveAction,
}: {
  action: AgentToolAction
  tool: AgentProviderTool
  onConfigureAction: (target: ToolSettingTarget) => void
  onRemoveAction: (actionId: string) => void
}) => {
  const { t } = useTranslation('agentV2')
  const readOnly = useAgentOrchestrateReadOnly()
  const handleConfigureAction = useCallback(() => {
    onConfigureAction({ actionId: action.id, toolId: tool.id })
  }, [action.id, onConfigureAction, tool.id])
  const handleRemoveAction = useCallback(() => {
    onRemoveAction(action.id)
  }, [action.id, onRemoveAction])

  return (
    <div className="group relative flex min-h-7 items-center gap-1 rounded-md py-px pr-0 pl-1 hover:bg-state-base-hover">
      <div className="absolute top-0 bottom-0 left-[13.5px] w-px bg-divider-regular" />
      <div className="flex min-w-0 flex-1 items-center py-1 pl-7">
        <span className="min-w-0 flex-1 truncate system-sm-regular text-text-secondary">
          {action.name}
        </span>
      </div>
      {!readOnly && (
        <div className="hidden shrink-0 items-center gap-1 px-0.5 group-focus-within:flex group-hover:flex">
          <button
            type="button"
            aria-label={t($ => $['agentDetail.configure.tools.editAction'], { name: action.name })}
            onClick={handleConfigureAction}
            className="flex size-6 items-center justify-center rounded-md text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
          >
            <span aria-hidden className="i-ri-equalizer-2-line size-4" />
          </button>
          <button
            type="button"
            aria-label={t($ => $['agentDetail.configure.tools.removeAction'], { name: action.name })}
            onClick={handleRemoveAction}
            className="flex size-6 items-center justify-center rounded-md text-text-tertiary hover:bg-state-destructive-hover hover:text-text-destructive focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
          >
            <span aria-hidden className="i-ri-delete-bin-line size-4" />
          </button>
        </div>
      )}
    </div>
  )
})

export const AgentProviderToolItem = memo(({
  tool,
  isExpanded,
  onOpenChange,
  onConfigureAction,
  onRemoveAction,
  onRemoveProvider,
  onCredentialChange,
}: {
  tool: AgentProviderTool
  isExpanded: boolean
  onOpenChange: (open: boolean) => void
  onConfigureAction: (target: ToolSettingTarget) => void
  onRemoveAction: (actionId: string) => void
  onRemoveProvider: () => void
  onCredentialChange: (credentialId?: string, credentialType?: AgentProviderTool['credentialType']) => void
}) => {
  const { t } = useTranslation('agentV2')
  const readOnly = useAgentOrchestrateReadOnly()
  const { theme } = useTheme()
  const icon = theme === Theme.dark && tool.iconDark ? tool.iconDark : tool.icon
  const displayName = tool.displayName ?? tool.name

  return (
    <CollapsibleRoot
      open={isExpanded}
      onOpenChange={onOpenChange}
      className="overflow-hidden rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg p-1 shadow-xs shadow-shadow-shadow-3"
    >
      <div className="flex min-h-7 items-center gap-1 rounded-lg py-0.5 pr-0.5 pl-1">
        <CollapsibleTrigger
          className="group min-h-0 min-w-0 flex-1 justify-start gap-2 rounded-md px-0 pr-1 text-left hover:not-data-disabled:bg-transparent hover:not-data-disabled:text-text-secondary data-panel-open:text-text-secondary"
        >
          <ProviderIcon icon={icon} iconClassName={tool.iconClassName} />
          <span className="flex min-w-0 items-center">
            <span className="min-w-0 truncate system-sm-medium text-text-primary">
              {displayName}
            </span>
            <span
              aria-hidden
              className={cn(
                'i-custom-vender-solid-arrows-arrow-down-round-fill size-4 shrink-0 -rotate-90 text-text-quaternary transition-transform group-data-panel-open:rotate-0 motion-reduce:transition-none',
              )}
            />
          </span>
        </CollapsibleTrigger>
        {!readOnly && (
          <>
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger
                aria-label={t($ => $['agentDetail.configure.tools.moreActions'], { name: tool.name })}
                className="flex size-6 shrink-0 items-center justify-center rounded-md text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden data-popup-open:bg-state-base-hover"
              >
                <span className="sr-only">{t($ => $['agentDetail.configure.tools.moreActions'], { name: tool.name })}</span>
                <span aria-hidden className="i-ri-more-fill size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent placement="bottom-end" sideOffset={4} popupClassName="w-44">
                <DropdownMenuItem
                  variant="destructive"
                  className="gap-2"
                  onClick={onRemoveProvider}
                >
                  <span aria-hidden className="i-ri-delete-bin-line size-4 shrink-0" />
                  <span>{t($ => $['agentDetail.configure.tools.removeProvider'])}</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <CredentialStatus tool={tool} onCredentialChange={onCredentialChange} />
          </>
        )}
      </div>

      <CollapsiblePanel>
        {isExpanded && (
          <div className="flex flex-col">
            {tool.actions.map(action => (
              <ProviderToolActionItem
                key={action.id}
                action={action}
                tool={tool}
                onConfigureAction={onConfigureAction}
                onRemoveAction={onRemoveAction}
              />
            ))}
          </div>
        )}
      </CollapsiblePanel>
    </CollapsibleRoot>
  )
})
