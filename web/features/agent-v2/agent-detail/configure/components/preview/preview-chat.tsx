'use client'

import type { AgentChatRuntimeEmptyStateProps, AgentChatRuntimeProps } from './chat-runtime'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import { AgentChatRuntime } from './chat-runtime'
import { sendPreviewChatMessage } from './preview-chat-request'

type AgentPreviewChatProps = Omit<
  AgentChatRuntimeProps,
  'draftType' | 'inputPlaceholder' | 'renderEmptyState' | 'sendMessage'
>

function AgentPreviewChatEmptyState({
  agentIcon,
  agentIconBackground,
  agentIconType,
  agentName,
  hasInstructions,
}: AgentChatRuntimeEmptyStateProps) {
  const { t } = useTranslation('agentV2')
  const imageUrl = agentIconType === 'image' || agentIconType === 'link' ? agentIcon : undefined
  const iconType = imageUrl ? 'image' : agentIconType

  return (
    <>
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
        {agentName || t(($) => $['agentDetail.configure.preview.empty.defaultAgentName'])}
      </div>
      <p className="mt-1 max-w-full body-md-regular text-text-tertiary">
        {t(($) => $['agentDetail.configure.preview.empty.description'])}
      </p>
      {!hasInstructions && (
        <p className="mt-1 max-w-full body-md-regular text-text-tertiary">
          {t(($) => $['agentDetail.configure.preview.empty.noInstructionsDescription'])}
        </p>
      )}
    </>
  )
}

export function AgentPreviewChat(props: AgentPreviewChatProps) {
  const { t } = useTranslation('agentV2')
  const agentName =
    props.agentName || t(($) => $['agentDetail.configure.preview.empty.defaultAgentName'])

  return (
    <AgentChatRuntime
      {...props}
      inputPlaceholder={t(($) => $['agentDetail.configure.preview.inputPlaceholder'], {
        name: agentName,
      })}
      sendMessage={sendPreviewChatMessage}
      renderEmptyState={(emptyStateProps) => <AgentPreviewChatEmptyState {...emptyStateProps} />}
    />
  )
}
