import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuPopup,
  DropdownMenuPortal,
  DropdownMenuPositioner,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { Switch } from '@langgenius/dify-ui/switch'
import { memo, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
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
          setOpen((prev) => !prev)
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <span aria-hidden className="i-ri-more-fill size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuPortal>
        <DropdownMenuPositioner placement="bottom-end" sideOffset={4}>
          <DropdownMenuPopup>
            <div className="min-w-48 rounded-md border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-xl">
              <div className="p-1">
                <DropdownMenuItem
                  className="justify-between rounded-md px-3 text-sm text-text-secondary"
                  onClick={() => {
                    setOpen(false)
                    onCopy()
                  }}
                >
                  {t(($) => $['common.copy'], { ns: 'workflow' })}
                  <ShortcutKbd shortcut="workflow.copy" />
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="justify-between rounded-md px-3 text-sm text-text-secondary"
                  onClick={() => {
                    setOpen(false)
                    onDuplicate()
                  }}
                >
                  {t(($) => $['common.duplicate'], { ns: 'workflow' })}
                  <ShortcutKbd shortcut="workflow.duplicate" />
                </DropdownMenuItem>
              </div>
              <DropdownMenuSeparator className="my-0" />
              <div className="p-1">
                <div
                  className="flex h-8 cursor-pointer items-center justify-between rounded-md px-3 text-sm text-text-secondary hover:bg-state-base-hover"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div>{t(($) => $['nodes.note.editor.showAuthor'], { ns: 'workflow' })}</div>
                  <Switch size="lg" checked={showAuthor} onCheckedChange={onShowAuthorChange} />
                </div>
              </div>
              <DropdownMenuSeparator className="my-0" />
              <div className="p-1">
                <DropdownMenuItem
                  variant="destructive"
                  className="justify-between rounded-md px-3 text-sm text-text-secondary"
                  onClick={() => {
                    setOpen(false)
                    onDelete()
                  }}
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
