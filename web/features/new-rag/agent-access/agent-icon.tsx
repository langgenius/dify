import { cn } from '@langgenius/dify-ui/cn'
import { recogniseAgent } from './agents'

/** A small mark for an agent or token, so rows of connections are not text only. */
export function AgentIcon({
  className,
  name,
  personal = false,
}: {
  className?: string
  name?: string | null
  personal?: boolean
}) {
  const icon = personal
    ? 'i-ri-key-2-line text-text-tertiary'
    : (recogniseAgent(name)?.icon ?? 'i-custom-vender-other-mcp text-text-tertiary')
  return (
    <span
      aria-hidden
      className={cn(
        'flex size-5 shrink-0 items-center justify-center rounded-md border-[0.5px] border-divider-regular bg-components-panel-bg',
        className,
      )}
    >
      <span className={cn('size-3.5', icon)} />
    </span>
  )
}
