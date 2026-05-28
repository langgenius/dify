import type { ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'

type IntegrationPageHeaderProps = {
  align?: 'start' | 'center'
  description?: ReactNode
  descriptionClassName?: string
  frameClassName: string
  title?: ReactNode
}

export function IntegrationPageHeader({
  align = 'start',
  description,
  descriptionClassName,
  frameClassName,
  title,
}: IntegrationPageHeaderProps) {
  const showDescription = description !== undefined && description !== null

  return (
    <div className={cn('flex min-h-14 shrink-0', align === 'start' ? 'items-start' : 'items-center justify-between')}>
      <div className={cn(
        'flex min-w-0 flex-1 justify-between',
        align === 'start' ? 'items-end gap-3 pt-2 pb-2' : 'items-center py-2',
        frameClassName,
      )}
      >
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="system-xl-semibold text-text-primary">
            {title}
          </div>
          {showDescription && (
            <div className={cn(descriptionClassName ?? 'system-sm-regular', 'text-text-tertiary')}>
              {description}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
