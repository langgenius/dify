import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'
import { useCallback, useState } from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/app/components/base/ui/dropdown-menu'
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
  const [open, setOpen] = useState(false)

  const handleBreadCrumbClick = useCallback((index: number) => {
    onBreadcrumbClick(index)
    setOpen(false)
  }, [onBreadcrumbClick])

  return (
    <DropdownMenu
      open={open}
      onOpenChange={setOpen}
    >
      <DropdownMenuTrigger render={<div />}>
        <button
          type="button"
          className={cn(
            'flex size-6 items-center justify-center rounded-md',
            open ? 'bg-state-base-hover' : 'hover:bg-state-base-hover',
          )}
        >
          <span aria-hidden className="i-ri-more-fill size-4 text-text-tertiary" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        placement="bottom-start"
        sideOffset={4}
        popupClassName="border-0 bg-transparent p-0 shadow-none backdrop-blur-none"
      >
        <Menu
          breadcrumbs={breadcrumbs}
          startIndex={startIndex}
          onBreadcrumbClick={handleBreadCrumbClick}
        />
      </DropdownMenuContent>
      <span className="system-xs-regular text-divider-deep">/</span>
    </DropdownMenu>
  )
}

export default React.memo(Dropdown)
