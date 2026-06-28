'use client'

import type { AgentSoulConfig } from '@dify/contracts/api/console/agent/types.gen'
import type { AgentConfigureConversationIds, AgentConfigureRightPanelMode } from '../../state'
import { useAgentPreviewSoulConfig } from '../../hooks'
import { AgentBuildChat } from './build-chat'
import { AgentPreviewChat } from './preview-chat'

export function AgentConfigureRightPanelChat({
  agentSoulConfig,
  conversationIds,
  mode,
  onConversationComplete,
  onConversationIdChange,
  ...props
}: Omit<Parameters<typeof AgentPreviewChat>[0], 'agentSoulConfig' | 'conversationId' | 'onConversationComplete' | 'onConversationIdChange'> & {
  agentSoulConfig?: AgentSoulConfig
  conversationIds: AgentConfigureConversationIds
  mode: AgentConfigureRightPanelMode
  onConversationComplete?: (mode: AgentConfigureRightPanelMode) => void
  onConversationIdChange: (mode: AgentConfigureRightPanelMode, conversationId: string) => void
}) {
  const previewAgentSoulConfig = useAgentPreviewSoulConfig(agentSoulConfig)
  const conversationId = conversationIds[mode]
  const handleConversationIdChange = (newConversationId: string) => {
    onConversationIdChange(mode, newConversationId)
  }
  const handleConversationComplete = () => {
    onConversationComplete?.(mode)
  }

  return mode === 'build'
    ? (
        <AgentBuildChat
          {...props}
          conversationId={conversationId}
          agentSoulConfig={previewAgentSoulConfig}
          onConversationComplete={handleConversationComplete}
          onConversationIdChange={handleConversationIdChange}
        />
      )
    : (
        <AgentPreviewChat
          {...props}
          conversationId={conversationId}
          agentSoulConfig={previewAgentSoulConfig}
          onConversationComplete={handleConversationComplete}
          onConversationIdChange={handleConversationIdChange}
        />
      )
}
