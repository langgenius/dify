'use client'

import type { AgentChatRuntimeEmptyStateProps, AgentChatRuntimeProps } from './chat-runtime'
import { useTranslation } from 'react-i18next'
import { AgentChatRuntime } from './chat-runtime'

const buildIconGridCells = Array.from({ length: 16 }, (_, index) => `build-icon-cell-${index}`)

type AgentBuildChatProps = Omit<AgentChatRuntimeProps, 'inputPlaceholder' | 'renderEmptyState'>

function AgentBuildChatEmptyState({
  inputNode,
}: AgentChatRuntimeEmptyStateProps) {
  const { t } = useTranslation('agentV2')

  return (
    <div className="flex h-full items-center justify-center">
      <div className="flex w-full max-w-150 flex-col items-start p-3 text-left">
        <div className="relative flex size-12 items-center justify-center overflow-hidden rounded-xl border-[0.5px] border-components-panel-border-subtle bg-background-default-dimmed text-text-tertiary">
          <div className="grid size-full grid-cols-4 grid-rows-4 gap-px p-1">
            {buildIconGridCells.map(cell => (
              <span key={cell} className="rounded-[1px] bg-divider-subtle" />
            ))}
          </div>
          <span aria-hidden className="absolute i-ri-hammer-line size-5 text-text-tertiary" />
        </div>
        <div className="mt-3 max-w-full truncate system-md-medium text-text-secondary">
          {t('agentDetail.configure.build.empty.title')}
        </div>
        <p className="mt-1 max-w-full body-md-regular text-text-tertiary">
          {t('agentDetail.configure.build.empty.description')}
        </p>
        {inputNode}
      </div>
    </div>
  )
}

export function AgentBuildChat(props: AgentBuildChatProps) {
  const { t } = useTranslation('agentV2')

  return (
    <AgentChatRuntime
      {...props}
      inputPlaceholder={t('agentDetail.configure.build.inputPlaceholder')}
      renderEmptyState={(emptyStateProps: AgentChatRuntimeEmptyStateProps) => (
        <AgentBuildChatEmptyState {...emptyStateProps} />
      )}
    />
  )
}
