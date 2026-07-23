'use client'

import type { AgentChatRuntimeProps } from './chat-runtime'
import { useTranslation } from 'react-i18next'
import { sendBuildChatMessage } from './build-chat-request'
import { CommunityEditionTip } from '../community-edition-tip'
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
].flatMap((row) => row.split(' ').map(Number))

const buildIconGridCells = buildIconGridCellOpacities.map((opacity, index) => ({
  id: `build-icon-cell-${Math.floor(index / 8)}-${index % 8}`,
  opacity,
}))

type AgentBuildChatProps = Omit<
  AgentChatRuntimeProps,
  'draftType' | 'inputPlaceholder' | 'renderEmptyState' | 'sendButtonLabel' | 'sendMessage'
>

function AgentBuildChatEmptyState() {
  const { t } = useTranslation('agentV2')
  const communityEditionBuildModeTip = t(
    ($) => $['agentDetail.configure.build.empty.communityEditionTip'],
  )

  return (
    <>
      <div className="dify-blue-glass-surface relative flex h-[50px] w-12 items-center justify-center rounded-xl p-2">
        <div className="absolute inset-x-px inset-y-0.5 grid grid-cols-[repeat(8,4px)] grid-rows-[repeat(8,4px)] gap-0.5 opacity-25">
          {buildIconGridCells.map((cell) => (
            <span
              key={cell.id}
              className={cell.opacity > 0 ? 'rounded-[1px] bg-[#98A2B2]' : 'invisible'}
              style={{ opacity: cell.opacity }}
            />
          ))}
        </div>
        <span
          aria-hidden
          className="absolute i-ri-hammer-line size-5 text-saas-dify-blue-inverted"
        />
      </div>
      <div className="mt-3 flex max-w-full items-center gap-1.5">
        <div className="min-w-0 truncate system-md-medium text-text-secondary">
          {t(($) => $['agentDetail.configure.build.empty.title'])}
        </div>
        <CommunityEditionTip
          tip={communityEditionBuildModeTip}
          placement="top"
          popupClassName="max-w-[340px]"
        />
      </div>
      <p className="mt-1 max-w-full body-md-regular text-text-tertiary">
        {t(($) => $['agentDetail.configure.build.empty.description'])}
      </p>
    </>
  )
}

export function AgentBuildChat(props: AgentBuildChatProps) {
  const { t } = useTranslation('agentV2')

  return (
    <AgentChatRuntime
      {...props}
      draftType="debug_build"
      inputPlaceholder={t(($) => $['agentDetail.configure.build.inputPlaceholder'])}
      inputAutoFocus={false}
      sendButtonLabel={t(($) => $['agentDetail.configure.build.startBuild'])}
      sendMessage={sendBuildChatMessage}
      renderEmptyState={() => <AgentBuildChatEmptyState />}
    />
  )
}
