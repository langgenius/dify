import { AgentBuildGridTexture } from '../agent-detail/configure/components/build-grid-texture'

export function AgentTemplateGridBackground() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]"
    >
      <AgentBuildGridTexture className="absolute right-0 bottom-0 origin-center scale-y-[-1]" />
    </div>
  )
}
