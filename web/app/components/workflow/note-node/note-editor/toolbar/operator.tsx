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
            'flex items-center justify-center w-8 h-8 cursor-pointer rounded-lg text-text-tertiary hover:text-text-secondary hover:bg-state-base-hover',
            open && 'bg-state-base-hover text-text-secondary',
          )}
        >
          <RiMoreFill className='w-4 h-4' />
        </div>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent>
        <div className='min-w-[192px] bg-components-panel-bg-blur rounded-md border-[0.5px] border-components-panel-border shadow-xl'>
          <div className='p-1'>
            <div
              className='flex items-center justify-between px-3 h-8 cursor-pointer rounded-md text-sm text-text-secondary hover:bg-state-base-hover'
              onClick={() => {
                onCopy()
                setOpen(false)
              }}
            >
              {t('workflow.common.copy')}
              <ShortcutsName keys={['ctrl', 'c']} />
            </div>
            <div
              className='flex items-center justify-between px-3 h-8 cursor-pointer rounded-md text-sm text-text-secondary hover:bg-state-base-hover'
              onClick={() => {
                onDuplicate()
                setOpen(false)
              }}
            >
              {t('workflow.common.duplicate')}
              <ShortcutsName keys={['ctrl', 'd']} />
            </div>
          </div>
          <div className='h-[1px] bg-divider-subtle'></div>
          <div className='p-1'>
            <div
              className='flex items-center justify-between px-3 h-8 cursor-pointer rounded-md text-sm text-text-secondary hover:bg-state-base-hover'
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
          <div className='h-[1px] bg-divider-subtle'></div>
          <div className='p-1'>
            <div
              className='flex items-center justify-between px-3 h-8 cursor-pointer rounded-md text-sm text-text-secondary hover:text-text-destructive hover:bg-state-destructive-hover'
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
