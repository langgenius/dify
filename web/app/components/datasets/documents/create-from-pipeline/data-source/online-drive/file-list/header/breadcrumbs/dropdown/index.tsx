import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Menu from './menu'

type DropdownProps = {
  startIndex: number
  breadcrumbs: string[]
  onBreadcrumbClick: (index: number) => void
}

const Dropdown = ({
  startIndex,
  breadcrumbs,
  onBreadcrumbClick,
}: DropdownProps) => {
  const { t } = useTranslation()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={(
          <button
            type="button"
            aria-label={t($ => $['operation.more'], { ns: 'common' })}
            className={cn(
              'flex size-6 items-center justify-center rounded-md',
              'hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid data-popup-open:bg-state-base-hover',
            )}
          >
            <span aria-hidden className="i-ri-more-fill size-4 text-text-tertiary" />
          </button>
        )}
      />
      <DropdownMenuContent
        placement="bottom-start"
        sideOffset={4}
        popupClassName="border-0 bg-transparent p-0 shadow-none backdrop-blur-none"
      >
        <Menu
          breadcrumbs={breadcrumbs}
          startIndex={startIndex}
          onBreadcrumbClick={onBreadcrumbClick}
        />
      </DropdownMenuContent>
      <span className="system-xs-regular text-divider-deep">/</span>
    </DropdownMenu>
  )
}

export default React.memo(Dropdown)
