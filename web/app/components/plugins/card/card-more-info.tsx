import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'
import DownloadCount from './base/download-count'

type Props = Readonly<{
  downloadCount?: number
  tags: string[]
  variant?: 'default' | 'marketplace'
}>

const CardMoreInfoComponent = ({ downloadCount, tags, variant = 'default' }: Props) => {
  if (variant === 'marketplace') {
    return (
      <div className="flex min-h-7 items-center py-1">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1 overflow-hidden">
          {tags.map((tag) => (
            <div
              key={tag}
              className={cn(
                'flex max-w-[120px] min-w-[18px] shrink-0 items-center justify-center gap-0.5 overflow-hidden rounded-[5px]',
                'border border-divider-deep bg-components-badge-bg-dimm px-[5px] py-[3px]',
                'system-2xs-medium-uppercase text-text-tertiary',
              )}
            >
              <span className="i-ri-price-tag-3-line h-3 w-3 shrink-0 text-text-quaternary" />
              <span className="truncate">{tag}</span>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-5 items-center">
      {downloadCount !== undefined && <DownloadCount downloadCount={downloadCount} />}
      {downloadCount !== undefined && tags && tags.length > 0 && (
        <div className="mx-2 system-xs-regular text-text-quaternary">·</div>
      )}
      {tags && tags.length > 0 && (
        <>
          <div className="flex h-4 flex-wrap space-x-2 overflow-hidden">
            {tags.map((tag) => (
              <div
                key={tag}
                className="flex max-w-[120px] space-x-1 overflow-hidden system-xs-regular"
              >
                <span className="text-text-quaternary">#</span>
                <span className="truncate text-text-tertiary">{tag}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// Memoize to prevent unnecessary re-renders when tags array hasn't changed
const CardMoreInfo = React.memo(CardMoreInfoComponent)

export default CardMoreInfo
