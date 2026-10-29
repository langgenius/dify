import type { RetrievalQueryImage } from './model'
import { cn } from '@langgenius/dify-ui/cn'

/**
 * One query image at thumbnail size. A persisted image whose file has since been removed has
 * no preview URL and is shown as a labelled placeholder instead of a broken image.
 */
export function QueryImageThumbnail({
  className,
  image,
}: {
  className?: string
  image: RetrievalQueryImage
}) {
  const frame = cn('rounded-lg ring-1 ring-components-panel-border', className)
  if (!image.previewUrl) {
    return (
      <span
        aria-label={image.name}
        className={cn(frame, 'flex items-center justify-center bg-background-section')}
        role="img"
      >
        <span aria-hidden className="i-ri-image-line size-5 text-text-quaternary" />
      </span>
    )
  }
  return <img alt={image.name} className={cn(frame, 'object-cover')} src={image.previewUrl} />
}
