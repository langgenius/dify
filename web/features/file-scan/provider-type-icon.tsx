import type { FileScanProviderType } from './provider-types'
import { cn } from '@langgenius/dify-ui/cn'
import { basePath } from '@/utils/var'

// Each vendor's own mark, taken from its official site, so a scanner is recognizable at a glance.
const BRAND_LOGOS: Partial<Record<FileScanProviderType, string>> = {
  clamav: 'clamav.png',
  cloudmersive: 'cloudmersive.png',
  scanii: 'scanii.svg',
  metadefender: 'metadefender.png',
}

type ProviderTypeIconProps = {
  type: FileScanProviderType
  className?: string
}

/** The brand logo of a scanner type; a custom endpoint has no brand and keeps a generic icon. */
export function ProviderTypeIcon({ type, className }: ProviderTypeIconProps) {
  const logo = BRAND_LOGOS[type]
  if (!logo) {
    return (
      <span aria-hidden className={cn('i-ri-plug-line size-4 text-text-secondary', className)} />
    )
  }
  return (
    <img
      alt=""
      aria-hidden
      src={`${basePath}/images/file-scan/${logo}`}
      className={cn('size-5 shrink-0 rounded-sm object-contain', className)}
    />
  )
}
