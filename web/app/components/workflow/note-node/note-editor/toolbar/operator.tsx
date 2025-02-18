import {
  memo,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { RiMoreFill } from '@remixicon/react'
import cn from '@/utils/classnames'
import ShortcutsName from '@/app/components/workflow/shortcuts-name'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import Switch from '@/app/components/base/switch'

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
      placement='bottom-end'
      offset={4}
    >
      <PortalToFollowElemTrigger onClick={() => setOpen(!open)}>
        <div
          className={cn(
            'text-text-tertiary hover:text-text-secondary hover:bg-state-base-hover flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg',
            open && 'bg-state-base-hover text-text-secondary',
          )}
        >
          <RiMoreFill className='h-4 w-4' />
        </div>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent>
        <div className='bg-components-panel-bg-blur border-components-panel-border min-w-[192px] rounded-md border-[0.5px] shadow-xl'>
          <div className='p-1'>
            <div
              className='text-text-secondary hover:bg-state-base-hover flex h-8 cursor-pointer items-center justify-between rounded-md px-3 text-sm'
              onClick={() => {
                onCopy()
                setOpen(false)
              }}
            >
              {t('workflow.common.copy')}
              <ShortcutsName keys={['ctrl', 'c']} />
            </div>
            <div
              className='text-text-secondary hover:bg-state-base-hover flex h-8 cursor-pointer items-center justify-between rounded-md px-3 text-sm'
              onClick={() => {
                onDuplicate()
                setOpen(false)
              }}
            >
              {t('workflow.common.duplicate')}
              <ShortcutsName keys={['ctrl', 'd']} />
            </div>
          </div>
          <div className='bg-divider-subtle h-[1px]'></div>
          <div className='p-1'>
            <div
              className='text-text-secondary hover:bg-state-base-hover flex h-8 cursor-pointer items-center justify-between rounded-md px-3 text-sm'
              onClick={e => e.stopPropagation()}
            >
              <div>{t('workflow.nodes.note.editor.showAuthor')}</div>
              <Switch
                size='l'
                defaultValue={showAuthor}
                onChange={onShowAuthorChange}
              />
            </div>
          </div>
          <div className='bg-divider-subtle h-[1px]'></div>
          <div className='p-1'>
            <div
              className='text-text-secondary hover:text-text-destructive hover:bg-state-destructive-hover flex h-8 cursor-pointer items-center justify-between rounded-md px-3 text-sm'
              onClick={() => {
                onDelete()
                setOpen(false)
              }}
            >
              {t('common.operation.delete')}
              <ShortcutsName keys={['del']} />
            </div>
          </div>
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default memo(Operator)
