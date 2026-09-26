import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuCheckboxItemIndicator,
  DropdownMenuItem,
  DropdownMenuPopup,
  DropdownMenuPortal,
  DropdownMenuPositioner,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { memo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStoreApi } from 'reactflow'
import { handleWorkflowMenuKeyDown } from '@/app/components/workflow/shortcuts/handle-workflow-menu-key-down'
import { ShortcutKbd } from '@/app/components/workflow/shortcuts/shortcut-kbd'

export type OperatorProps = {
  onCopy: () => void
  onDuplicate: () => void
  onDelete: () => void
  showAuthor: boolean
  onShowAuthorChange: (showAuthor: boolean) => void
}
const Operator = ({
  onCopy,
  onDelete,
  onDuplicate,
  showAuthor,
  onShowAuthorChange,
}: OperatorProps) => {
  const { t } = useTranslation(['common', 'workflow'])
  const [open, setOpen] = useState(false)
  const deletingRef = useRef(false)
  const flowStore = useStoreApi()

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) deletingRef.current = false
    setOpen(nextOpen)
  }

  function handleCopy() {
    setOpen(false)
    onCopy()
  }

  function handleDuplicate() {
    setOpen(false)
    onDuplicate()
  }

  function handleDelete() {
    deletingRef.current = true
    setOpen(false)
    onDelete()
  }

  return (
    <DropdownMenu open={open} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger
        aria-label={t(($) => $['operation.more'], { ns: 'common' })}
        className={cn(
          'flex size-8 cursor-pointer items-center justify-center rounded-lg text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary',
          'data-popup-open:bg-state-base-hover data-popup-open:text-text-secondary',
        )}
        onMouseDown={(event) => {
          event.preventDefault()
          event.stopPropagation()
          event.preventBaseUIHandler()
          handleOpenChange(!open)
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <span aria-hidden className="i-ri-more-fill size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuPortal>
        <DropdownMenuPositioner placement="bottom-end" sideOffset={4}>
          <DropdownMenuPopup
            finalFocus={() => (deletingRef.current ? (flowStore.getState().domNode ?? true) : true)}
            onKeyDown={(event) =>
              handleWorkflowMenuKeyDown(event, [
                ['workflow.copy', handleCopy],
                ['workflow.duplicate', handleDuplicate],
                ['workflow.delete', handleDelete],
              ])
            }
          >
            <div className="min-w-48 rounded-md border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-xl">
              <div className="p-1">
                <DropdownMenuItem
                  className="justify-between rounded-md px-3 text-sm text-text-secondary"
                  onClick={handleCopy}
                >
                  {t(($) => $['common.copy'], { ns: 'workflow' })}
                  <ShortcutKbd shortcut="workflow.copy" />
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="justify-between rounded-md px-3 text-sm text-text-secondary"
                  onClick={handleDuplicate}
                >
                  {t(($) => $['common.duplicate'], { ns: 'workflow' })}
                  <ShortcutKbd shortcut="workflow.duplicate" />
                </DropdownMenuItem>
              </div>
              <DropdownMenuSeparator className="my-0" />
              <div className="p-1">
                <DropdownMenuCheckboxItem
                  checked={showAuthor}
                  onCheckedChange={onShowAuthorChange}
                  closeOnClick={false}
                  className="justify-between rounded-md px-3 text-sm text-text-secondary"
                >
                  {t(($) => $['nodes.note.editor.showAuthor'], { ns: 'workflow' })}
                  <DropdownMenuCheckboxItemIndicator />
                </DropdownMenuCheckboxItem>
              </div>
              <DropdownMenuSeparator className="my-0" />
              <div className="p-1">
                <DropdownMenuItem
                  variant="destructive"
                  className="justify-between rounded-md px-3 text-sm text-text-secondary"
                  onClick={handleDelete}
                >
                  {t(($) => $['operation.delete'], { ns: 'common' })}
                  <ShortcutKbd shortcut="workflow.delete" />
                </DropdownMenuItem>
              </div>
            </div>
          </DropdownMenuPopup>
        </DropdownMenuPositioner>
      </DropdownMenuPortal>
    </DropdownMenu>
  )
}

export default memo(Operator)
