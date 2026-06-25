'use client'

import type { AgentChatRuntimeEmptyStateProps, AgentChatRuntimeProps } from './chat-runtime'
import { useTranslation } from 'react-i18next'
import { AgentChatRuntime } from './chat-runtime'

const buildIconGridCellOpacities = [
  '0 0 0.093 0.166 0 0 0.155 0',
  '0 0.159 0.145 0.159 0.135 0.179 0.128 0.105',
  '0.091 0 0.161 0.187 0.102 0 0.111 0',
  '0.148 0.159 0 0 0.195 0.158 0.342 0.128',
  '0.169 0.132 0 0.115 0.112 0.319 0.218 0.199',
  '0.241 0.206 0.124 0.181 0.212 0.211 0.315 0.127',
  '0.133 0.21 0.166 0.476 0.167 0.22 0.136 0.246',
  '0 0.132 0.151 0.146 0.276 0.256 0.269 0',
].flatMap(row => row.split(' ').map(Number))

const buildIconGridCells = buildIconGridCellOpacities.map((opacity, index) => ({
  id: `build-icon-cell-${Math.floor(index / 8)}-${index % 8}`,
  opacity,
}))

type AgentBuildChatProps = Omit<AgentChatRuntimeProps, 'inputPlaceholder' | 'renderEmptyState' | 'sendButtonLabel'>

function AgentBuildChatEmptyState({
  inputNode,
}: AgentChatRuntimeEmptyStateProps) {
  const { t } = useTranslation('agentV2')

  return (
    <div className="flex h-full items-center justify-center">
      <div className="flex w-full max-w-150 flex-col items-start p-3 text-left">
        <div className="main-nav-active-glass relative flex h-[50px] w-12 items-center justify-center rounded-xl p-2">
          <div className="absolute inset-x-px inset-y-0.5 grid grid-cols-[repeat(8,4px)] grid-rows-[repeat(8,4px)] gap-0.5 opacity-25">
            {buildIconGridCells.map(cell => (
              <span
                key={cell.id}
                className={cell.opacity > 0 ? 'rounded-[1px] bg-[#98A2B2]' : 'invisible'}
                style={{ opacity: cell.opacity }}
              />
            ))}
          </div>
          <span aria-hidden className="absolute i-ri-hammer-line size-5 text-saas-dify-blue-inverted" />
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
      sendButtonLabel={t('agentDetail.configure.build.startBuild')}
      renderEmptyState={(emptyStateProps: AgentChatRuntimeEmptyStateProps) => (
        <AgentBuildChatEmptyState {...emptyStateProps} />
      )}
    />
  )
}
