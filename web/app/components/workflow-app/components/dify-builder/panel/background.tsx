import { memo } from 'react'
import { AgentBuildGridTexture } from '@/features/agent-v2/agent-detail/configure/components/build-grid-texture'

export const DifyBuilderPanelBackground = memo(() => {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden bg-background-default-burn bg-linear-to-b from-background-gradient-bg-fill-chat-bg-1/90 to-background-gradient-bg-fill-chat-bg-2/90 to-[90.48%]"
    >
      <AgentBuildGridTexture className="absolute top-0 right-0" />
      <AgentBuildGridTexture className="absolute right-0 bottom-0 origin-center scale-y-[-1] opacity-60" />
    </div>
  )
})
