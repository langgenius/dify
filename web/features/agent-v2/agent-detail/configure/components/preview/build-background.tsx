import { cn } from '@langgenius/dify-ui/cn'
import buildHeaderBackground from './build-header-background.svg'

export function AgentBuildHeaderBackground({
  visible,
}: {
  visible: boolean
}) {
  return (
    <div
      aria-hidden
      className={cn(
        'pointer-events-none absolute top-0 right-0 left-0 z-0 h-60 overflow-hidden opacity-0 transition-opacity duration-150 motion-reduce:transition-none',
        visible && 'opacity-100',
      )}
    >
      <img
        src={buildHeaderBackground.src}
        alt=""
        className="absolute inset-0 size-full max-w-none object-fill"
        draggable={false}
      />
    </div>
  )
}
