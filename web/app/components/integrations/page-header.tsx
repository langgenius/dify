import type { ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'

type IntegrationPageHeaderProps = {
  align?: 'start' | 'center'
  description?: ReactNode
  descriptionClassName?: string
  frameClassName: string
  title?: ReactNode
  toolbar?: ReactNode
}

export function IntegrationPageHeader({
  align = 'start',
  description,
  descriptionClassName,
  frameClassName,
  title,
  toolbar,
}: IntegrationPageHeaderProps) {
  const showDescription = description !== undefined && description !== null
  const showToolbar = toolbar !== undefined && toolbar !== null

  return (
    <div
      className={cn(
        'flex shrink-0',
        align === 'start' ? 'items-start' : 'min-h-14 items-center justify-between',
      )}
    >
      <div
        className={cn(
          'flex min-w-0 flex-1',
          showToolbar ? 'flex-col gap-3' : 'justify-between',
          align === 'start' ? 'items-start pt-3 pb-2' : 'items-center py-2',
          frameClassName,
        )}
      >
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="title-2xl-semi-bold text-text-primary">{title}</div>
          {showDescription && (
            <div className={cn(descriptionClassName ?? 'system-sm-regular', 'text-text-tertiary')}>
              {description}
            </div>
          )}
        </div>
        {showToolbar && <div className="flex w-full items-center justify-between">{toolbar}</div>}
      </div>
    </div>
  )
}
