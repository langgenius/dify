import { cn } from '@langgenius/dify-ui/cn'

export function VersionTimelineDot({
  isActive,
  isFirst,
  isLast,
}: {
  isActive: boolean
  isFirst: boolean
  isLast: boolean
}) {
  return (
    <div className="relative flex w-[18px] shrink-0 justify-center pt-1.5">
      {!isFirst && <div className="absolute top-0 h-2 w-0.5 bg-divider-subtle" />}
      <span
        aria-hidden
        className={cn(
          'relative z-1 size-2 rounded-full border-2 bg-components-panel-bg',
          isActive ? 'border-text-accent' : 'border-text-quaternary',
        )}
      />
      {!isLast && <div className="absolute top-3 bottom-[-18px] w-0.5 bg-divider-subtle" />}
    </div>
  )
}
