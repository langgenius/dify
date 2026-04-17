import { cn } from '@langgenius/dify-ui/cn'
import {
  memo,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import Switch from '@/app/components/base/switch'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/app/components/base/ui/dropdown-menu'
import ShortcutsName from '@/app/components/workflow/shortcuts-name'

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
    <DropdownMenu
      open={open}
      onOpenChange={setOpen}
    >
      <DropdownMenuTrigger
        nativeButton={false}
        render={<div />}
        aria-label={t('operation.more', { ns: 'common' })}
        className={cn(
          'flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary',
          open && 'bg-state-base-hover text-text-secondary',
        )}
        onMouseDown={(event) => {
          event.preventDefault()
          event.stopPropagation()
          ;(event as typeof event & { preventBaseUIHandler?: () => void }).preventBaseUIHandler?.()
          setOpen(prev => !prev)
        }}
        onClick={event => event.stopPropagation()}
      >
        <span aria-hidden className="i-ri-more-fill h-4 w-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        placement="bottom-end"
        sideOffset={4}
        popupClassName="border-0 bg-transparent p-0 shadow-none backdrop-blur-none"
      >
        <div className="min-w-[192px] rounded-md border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-xl">
          <div className="p-1">
            <DropdownMenuItem
              className="justify-between rounded-md px-3 text-sm text-text-secondary"
              onClick={() => {
                setOpen(false)
                onCopy()
              }}
            >
              {t('common.copy', { ns: 'workflow' })}
              <ShortcutsName keys={['ctrl', 'c']} />
            </DropdownMenuItem>
            <DropdownMenuItem
              className="justify-between rounded-md px-3 text-sm text-text-secondary"
              onClick={() => {
                setOpen(false)
                onDuplicate()
              }}
            >
              {t('common.duplicate', { ns: 'workflow' })}
              <ShortcutsName keys={['ctrl', 'd']} />
            </DropdownMenuItem>
          </div>
          <DropdownMenuSeparator className="my-0" />
          <div className="p-1">
            <div
              className="flex h-8 cursor-pointer items-center justify-between rounded-md px-3 text-sm text-text-secondary hover:bg-state-base-hover"
              onClick={e => e.stopPropagation()}
            >
              <div>{t('nodes.note.editor.showAuthor', { ns: 'workflow' })}</div>
              <Switch
                size="lg"
                checked={showAuthor}
                onCheckedChange={onShowAuthorChange}
              />
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
              {t('operation.delete', { ns: 'common' })}
              <ShortcutsName keys={['del']} />
            </DropdownMenuItem>
          </div>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export default memo(Operator)
