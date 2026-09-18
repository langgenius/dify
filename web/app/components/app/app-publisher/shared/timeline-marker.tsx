import { cn } from '@langgenius/dify-ui/cn'

export function PublisherTimelineMarker({ position }: { position: 'top' | 'bottom' }) {
  return (
    <span
      className={cn(
        'relative flex w-4 shrink-0 items-start p-1',
        position === 'top' ? 'self-stretch' : 'h-4',
      )}
    >
      <span
        aria-hidden
        className="relative z-1 size-2 rounded-full border-2 border-text-quaternary bg-components-panel-bg"
      />
      <span
        aria-hidden
        className={cn(
          'absolute left-1/2 w-0.5 -translate-x-1/2 bg-divider-subtle',
          position === 'top' ? 'top-3.5 -bottom-3.5' : '-top-3.5 h-4',
        )}
      />
    </span>
  )
}
