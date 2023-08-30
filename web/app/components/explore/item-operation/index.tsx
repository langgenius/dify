'use client'
import type { FC } from 'react'
import React from 'react'
import cn from 'classnames'
import { useTranslation } from 'react-i18next'
import { Edit03, Pin02, Trash03 } from '../../base/icons/src/vender/line/general'

import s from './style.module.css'
import Popover from '@/app/components/base/popover'

export type IItemOperationProps = {
  className?: string
  isPinned: boolean
  isShowRenameConversation?: boolean
  onRenameConversation?: () => void
  isShowDelete: boolean
  togglePin: () => void
  onDelete: () => void
}

const ItemOperation: FC<IItemOperationProps> = ({
  className,
  isPinned,
  togglePin,
  isShowRenameConversation,
  onRenameConversation,
  isShowDelete,
  onDelete,
}) => {
  const { t } = useTranslation()

  return (
    <Popover
      htmlContent={
        <div className='w-full py-1' onClick={(e) => {
          e.stopPropagation()
        }}>
          <div className={cn(s.actionItem, 'hover:bg-gray-50 group')} onClick={togglePin}>
            <Pin02 className='shrink-0 w-4 h-4 text-gray-500'/>
            <span className={s.actionName}>{isPinned ? t('explore.sidebar.action.unpin') : t('explore.sidebar.action.pin')}</span>
          </div>
          {isShowRenameConversation && (
            <div className={cn(s.actionItem, 'hover:bg-gray-50 group')} onClick={onRenameConversation}>
              <Edit03 className='shrink-0 w-4 h-4 text-gray-500'/>
              <span className={s.actionName}>{t('explore.sidebar.action.rename')}</span>
            </div>
          )}
          {isShowDelete && (
            <div className={cn(s.actionItem, s.deleteActionItem, 'hover:bg-gray-50 group')} onClick={onDelete} >
              <Trash03 className={cn(s.deleteActionItemChild, 'shrink-0 w-4 h-4 stroke-current text-gray-500 stroke-2')} />
              <span className={cn(s.actionName, s.deleteActionItemChild)}>{t('explore.sidebar.action.delete')}</span>
            </div>
          )}

        </div>
      }
      trigger='click'
      position='br'
      btnElement={<div />}
      btnClassName={open => cn(className, s.btn, 'h-6 w-6 rounded-md border-none py-1', open && '!bg-gray-100 !shadow-none')}
      className={'!w-[120px] !px-0 h-fit !z-20'}
    />
  )
}
export default React.memo(ItemOperation)
