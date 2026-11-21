import { BreadcrumbItem, BreadcrumbSeparator } from '@langgenius/dify-ui/breadcrumb'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@langgenius/dify-ui/menu'
import * as React from 'react'
import { useTranslation } from 'react-i18next'

type ActionsMenuProps = {
  startIndex: number
  breadcrumbs: string[]
  onBreadcrumbClick: (index: number) => void
}

const ActionsMenu = ({ startIndex, breadcrumbs, onBreadcrumbClick }: ActionsMenuProps) => {
  const { t } = useTranslation(['common'])

  return (
    <>
      <BreadcrumbItem className="shrink-0">
        <Menu>
          <MenuTrigger
            render={
              <IconButton
                aria-label={t(($) => $['operation.more'], { ns: 'common' })}
                className="data-popup-open:bg-state-base-hover"
              >
                <span aria-hidden className="i-ri-more-fill size-4" />
              </IconButton>
            }
          />
          <MenuContent align="start" className="w-34">
            {breadcrumbs.map((breadcrumb, index) => (
              <MenuItem
                key={breadcrumbs.slice(0, index + 1).join('/')}
                className="px-3 py-1.5 system-md-regular"
                onClick={() => onBreadcrumbClick(startIndex + index)}
              >
                {breadcrumb}
              </MenuItem>
            ))}
          </MenuContent>
        </Menu>
      </BreadcrumbItem>
      <BreadcrumbSeparator className="system-xs-regular text-divider-deep" />
    </>
  )
}

export default React.memo(ActionsMenu)
