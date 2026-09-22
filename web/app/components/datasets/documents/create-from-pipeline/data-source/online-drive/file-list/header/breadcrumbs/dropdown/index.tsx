import { BreadcrumbItem, BreadcrumbSeparator } from '@langgenius/dify-ui/breadcrumb'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import * as React from 'react'
import { useTranslation } from 'react-i18next'

type DropdownProps = {
  startIndex: number
  breadcrumbs: string[]
  onBreadcrumbClick: (index: number) => void
}

const Dropdown = ({ startIndex, breadcrumbs, onBreadcrumbClick }: DropdownProps) => {
  const { t } = useTranslation()

  return (
    <>
      <BreadcrumbItem className="shrink-0">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <IconButton
                aria-label={t(($) => $['operation.more'], { ns: 'common' })}
                className="data-popup-open:bg-state-base-hover"
              >
                <span aria-hidden className="i-ri-more-fill size-4" />
              </IconButton>
            }
          />
          <DropdownMenuContent placement="bottom-start" className="w-34 px-1">
            {breadcrumbs.map((breadcrumb, index) => (
              <DropdownMenuItem
                key={breadcrumbs.slice(0, index + 1).join('/')}
                className="px-3 py-1.5 system-md-regular"
                onClick={() => onBreadcrumbClick(startIndex + index)}
              >
                {breadcrumb}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </BreadcrumbItem>
      <BreadcrumbSeparator className="system-xs-regular text-divider-deep" />
    </>
  )
}

export default React.memo(Dropdown)
