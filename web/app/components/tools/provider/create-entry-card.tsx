'use client'
import { cn } from '@langgenius/dify-ui/cn'
import {
  RiAddLine,
  RiArrowRightUpLine,
} from '@remixicon/react'

type CreateEntryCardProps = {
  className?: string
  linkText: string
  linkUrl: string
  onCreate: () => void
  title: string
}

const CreateEntryCard = ({
  className,
  linkText,
  linkUrl,
  onCreate,
  title,
}: CreateEntryCardProps) => {
  return (
    <div className={cn('col-span-1 flex h-[120px] flex-col overflow-hidden rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg shadow-md', className)}>
      <button
        type="button"
        aria-label={title}
        title={title}
        className="group flex h-[84px] w-full cursor-pointer items-center gap-3 p-4 text-left outline-hidden hover:bg-components-panel-on-panel-item-bg-hover focus-visible:ring-1 focus-visible:ring-components-input-border-hover"
        onClick={onCreate}
      >
        <div className="flex size-10 shrink-0 items-center justify-center">
          <div className="flex size-10 items-center justify-center rounded-lg border-[0.5px] border-dashed border-divider-regular bg-background-body">
            <RiAddLine className="size-4 text-text-quaternary group-hover:text-text-accent" />
          </div>
        </div>
        <div className="min-w-0 flex-1 py-px">
          <div className="truncate system-md-semibold text-text-primary group-hover:text-text-accent" title={title}>
            {title}
          </div>
        </div>
      </button>
      <a
        href={linkUrl}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={linkText}
        title={linkText}
        className="flex h-8 items-center gap-0.5 border-t border-divider-subtle px-3 py-2 text-components-button-secondary-text outline-hidden hover:bg-components-panel-on-panel-item-bg-hover hover:text-text-accent focus-visible:ring-1 focus-visible:ring-components-input-border-hover"
      >
        <div className="min-w-0 flex-1 px-0.5">
          <div className="truncate system-sm-medium" title={linkText}>{linkText}</div>
        </div>
        <RiArrowRightUpLine className="size-4 shrink-0" />
      </a>
    </div>
  )
}

export default CreateEntryCard
