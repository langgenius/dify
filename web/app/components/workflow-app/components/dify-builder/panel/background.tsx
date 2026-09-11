import { memo } from 'react'
import { AgentBuildGridTexture } from '@/features/agent-v2/agent-detail/configure/components/build-grid-texture'

export const DifyBuilderPanelBackground = memo(() => {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <AgentBuildGridTexture className="absolute top-0 right-0" />
      <AgentBuildGridTexture className="absolute right-0 bottom-0 origin-center scale-y-[-1]" />
    </div>
  )
})
