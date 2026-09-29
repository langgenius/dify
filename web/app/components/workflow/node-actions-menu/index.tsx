import type { Node } from '@/app/components/workflow/types'
import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuPortal,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { NodeActionsDropdownContent } from './dropdown-content'

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
  const { t } = useTranslation(['common'])
  const [open, setOpen] = useState(false)

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen)
      onOpenChange?.(nextOpen)
    },
    [onOpenChange],
  )

  const closeMenu = useCallback(() => {
    setOpen(false)
    onOpenChange?.(false)
  }, [onOpenChange])

  return (
    <DropdownMenu modal={false} open={open} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger
        render={
          <IconButton
            size="md"
            aria-label={t(($) => $['operation.more'], { ns: 'common' })}
            className={cn('data-popup-open:bg-state-base-hover', triggerClassName)}
          >
            <span aria-hidden className="i-ri-more-fill size-4" />
          </IconButton>
        }
      />
      <DropdownMenuPortal>
        <NodeActionsDropdownContent
          id={id}
          data={data}
          onClose={closeMenu}
          showHelpLink={showHelpLink}
        />
      </DropdownMenuPortal>
    </DropdownMenu>
  )
}
