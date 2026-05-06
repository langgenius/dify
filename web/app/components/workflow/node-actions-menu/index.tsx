import type { Node } from '@/app/components/workflow/types'
import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { NodeActionsDropdownContent } from './dropdown-content'
import { NODE_ACTIONS_MENU_WIDTH_CLASS_NAME } from './shared'

type NodeActionsDropdownProps = {
  id: string
  data: Node['data']
  triggerClassName?: string
  onOpenChange?: (open: boolean) => void
  showHelpLink?: boolean
}

export function NodeActionsDropdown({
  id,
  data,
  triggerClassName,
  onOpenChange,
  showHelpLink = true,
}: NodeActionsDropdownProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    setOpen(nextOpen)
    onOpenChange?.(nextOpen)
  }, [onOpenChange])

  const closeMenu = useCallback(() => {
    setOpen(false)
    onOpenChange?.(false)
  }, [onOpenChange])

  return (
    <DropdownMenu
      modal={false}
      open={open}
      onOpenChange={handleOpenChange}
    >
      <DropdownMenuTrigger
        render={(
          <button
            type="button"
            aria-label={t('operation.more', { ns: 'common' })}
            className={cn(
              'flex h-6 w-6 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent p-0 text-text-tertiary hover:bg-state-base-hover',
              'focus-visible:ring-1 focus-visible:ring-components-input-border-hover focus-visible:outline-hidden data-popup-open:bg-state-base-hover',
              triggerClassName,
            )}
          >
            <span aria-hidden className="i-ri-more-fill h-4 w-4" />
          </button>
        )}
      />
      <DropdownMenuContent
        placement="bottom-end"
        popupClassName={NODE_ACTIONS_MENU_WIDTH_CLASS_NAME}
      >
        <NodeActionsDropdownContent
          id={id}
          data={data}
          onClose={closeMenu}
          showHelpLink={showHelpLink}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
