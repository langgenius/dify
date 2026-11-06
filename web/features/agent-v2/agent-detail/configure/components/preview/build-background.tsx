import { cn } from '@langgenius/dify-ui/cn'
import { BuildGridTexture } from '@/app/components/base/build-grid-texture'

export function AgentBuildPanelBackground({ visible }: { visible: boolean }) {
  return (
    <div
      aria-hidden
      className={cn(
        'pointer-events-none absolute inset-0 z-0 overflow-hidden rounded-[inherit] opacity-0 transition-opacity duration-150 motion-reduce:transition-none',
        visible && 'opacity-100',
      )}
    >
      <BuildGridTexture className="absolute top-0 left-0" />
      <BuildGridTexture className="absolute bottom-0 left-0 origin-center scale-y-[-1]" />
    </div>
  )
}
