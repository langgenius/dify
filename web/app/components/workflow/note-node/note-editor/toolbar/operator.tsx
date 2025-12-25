import { RiMoreFill } from '@remixicon/react'
import {
  memo,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import Switch from '@/app/components/base/switch'
import ShortcutsName from '@/app/components/workflow/shortcuts-name'
import { cn } from '@/utils/classnames'

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
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement="bottom-end"
      offset={4}
    >
      <PortalToFollowElemTrigger onClick={() => setOpen(!open)}>
        <div
          className={cn(
            'flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary',
            open && 'bg-state-base-hover text-text-secondary',
          )}
        >
          <RiMoreFill className="h-4 w-4" />
        </div>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent>
        <div className="min-w-[192px] rounded-md border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-xl">
          <div className="p-1">
            <div
              className="flex h-8 cursor-pointer items-center justify-between rounded-md px-3 text-sm text-text-secondary hover:bg-state-base-hover"
              onClick={() => {
                onCopy()
                setOpen(false)
              }}
            >
              {t('common.copy', { ns: 'workflow' })}
              <ShortcutsName keys={['ctrl', 'c']} />
            </div>
            <div
              className="flex h-8 cursor-pointer items-center justify-between rounded-md px-3 text-sm text-text-secondary hover:bg-state-base-hover"
              onClick={() => {
                onDuplicate()
                setOpen(false)
              }}
            >
              {t('common.duplicate', { ns: 'workflow' })}
              <ShortcutsName keys={['ctrl', 'd']} />
            </div>
          </div>
          <div className="h-px bg-divider-subtle"></div>
          <div className="p-1">
            <div
              className="flex h-8 cursor-pointer items-center justify-between rounded-md px-3 text-sm text-text-secondary hover:bg-state-base-hover"
              onClick={e => e.stopPropagation()}
            >
              <div>{t('nodes.note.editor.showAuthor', { ns: 'workflow' })}</div>
              <Switch
                size="l"
                defaultValue={showAuthor}
                onChange={onShowAuthorChange}
              />
            </div>
          </div>
          <div className="h-px bg-divider-subtle"></div>
          <div className="p-1">
            <div
              className="flex h-8 cursor-pointer items-center justify-between rounded-md px-3 text-sm text-text-secondary hover:bg-state-destructive-hover hover:text-text-destructive"
              onClick={() => {
                onDelete()
                setOpen(false)
              }}
            >
              {t('operation.delete', { ns: 'common' })}
              <ShortcutsName keys={['del']} />
            </div>
          </div>
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default memo(Operator)
