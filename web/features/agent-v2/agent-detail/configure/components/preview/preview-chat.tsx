'use client'

import type { AgentChatRuntimeEmptyStateProps, AgentChatRuntimeProps } from './chat-runtime'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import { AgentChatRuntime } from './chat-runtime'

type AgentPreviewChatProps = Omit<AgentChatRuntimeProps, 'inputPlaceholder' | 'renderEmptyState'>

function AgentPreviewChatEmptyState({
  agentIcon,
  agentIconBackground,
  agentIconType,
  agentName,
  hasInstructions,
  inputNode,
}: AgentChatRuntimeEmptyStateProps) {
  const { t } = useTranslation('agentV2')
  const imageUrl = (agentIconType === 'image' || agentIconType === 'link') ? agentIcon : undefined
  const iconType = imageUrl ? 'image' : agentIconType

  return (
    <div className="flex h-full items-center justify-center">
      <div className="flex w-full max-w-150 flex-col items-start p-3 text-left">
        <AppIcon
          size="xxl"
          rounded
          iconType={iconType}
          icon={agentIcon ?? undefined}
          background={agentIconBackground}
          imageUrl={imageUrl}
          className="bg-background-default"
        />
        <div className="mt-3 max-w-full truncate system-md-medium text-text-secondary">
          {t($ => $['agentDetail.configure.preview.empty.title'], {
            name: agentName || t($ => $['agentDetail.configure.preview.empty.defaultAgentName']),
          })}
        </div>
        <p className="mt-1 max-w-full body-md-regular text-text-tertiary">
          {t($ => $['agentDetail.configure.preview.empty.description'])}
        </p>
        {!hasInstructions && (
          <p className="mt-1 max-w-full body-md-regular text-text-tertiary">
            {t($ => $['agentDetail.configure.preview.empty.noInstructionsDescription'])}
          </p>
        )}
        {inputNode}
      </div>
    </div>
  )
}

export function AgentPreviewChat(props: AgentPreviewChatProps) {
  const { t } = useTranslation('agentV2')
  const agentName = props.agentName || t($ => $['agentDetail.configure.preview.empty.defaultAgentName'])

  return (
    <AgentChatRuntime
      {...props}
      inputPlaceholder={t($ => $['agentDetail.configure.preview.inputPlaceholder'], {
        name: agentName,
      })}
      renderEmptyState={emptyStateProps => (
        <AgentPreviewChatEmptyState {...emptyStateProps} />
      )}
    />
  )
}
