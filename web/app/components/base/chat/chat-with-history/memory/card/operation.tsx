'use client'
import type { FC } from 'react'
import React, { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RiCheckLine, RiMoreFill } from '@remixicon/react'
import ActionButton from '@/app/components/base/action-button'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import Divider from '@/app/components/base/divider'
import type { Memory } from '@/app/components/base/chat/types'
import cn from '@/utils/classnames'

type Props = {
  memory: Memory
  onEdit: () => void
  resetDefault: (memory: Memory) => void
  clearAllUpdateVersion: (memory: Memory) => void
  switchMemoryVersion: (memory: Memory, version: string) => void
}

const OperationDropdown: FC<Props> = ({
  memory,
  onEdit,
  resetDefault,
  clearAllUpdateVersion,
  switchMemoryVersion,
}) => {
  const { t } = useTranslation()
  const [open, doSetOpen] = useState(false)
  const openRef = useRef(open)
  const setOpen = useCallback((v: boolean) => {
    doSetOpen(v)
    openRef.current = v
  }, [doSetOpen])

  const handleTrigger = useCallback(() => {
    setOpen(!openRef.current)
  }, [setOpen])

  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement='bottom-end'
      offset={{
        mainAxis: 4,
        crossAxis: 4,
      }}
    >
      <PortalToFollowElemTrigger onClick={handleTrigger}>
        <div>
          <ActionButton className={cn(open && 'bg-state-base-hover')}>
            <RiMoreFill className='h-4 w-4' />
          </ActionButton>
        </div>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className='z-50'>
        <div className='w-[220px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg backdrop-blur-sm'>
          <div className='p-1'>
            <div className='system-md-regular cursor-pointer rounded-lg px-3 py-1.5 text-text-secondary hover:bg-state-base-hover' onClick={onEdit}>{t('share.chat.memory.operations.edit')}</div>
            <div className='system-md-regular cursor-pointer rounded-lg px-3 py-1.5 text-text-secondary hover:bg-state-base-hover' onClick={() => resetDefault(memory)}>{t('share.chat.memory.operations.reset')}</div>
            <div className='system-md-regular cursor-pointer rounded-lg px-3 py-1.5 text-text-secondary hover:bg-state-destructive-hover hover:text-text-destructive' onClick={() => clearAllUpdateVersion(memory)}>{t('share.chat.memory.operations.clear')}</div>
          </div>
          <Divider className='!my-0 !h-px bg-divider-subtle' />
          <div className='px-1 py-2'>
            <div className='system-xs-medium-uppercase px-3 pb-0.5 pt-1 text-text-tertiary'>{t('share.chat.memory.updateVersion.title')}</div>
            <div className='system-md-regular flex cursor-pointer items-center gap-1 rounded-lg px-3 py-1.5 text-text-secondary hover:bg-state-base-hover'>
              {t('share.chat.memory.operations.edit')}
              <RiCheckLine className='h-4 w-4 text-text-accent' />
            </div>
            <div className='system-md-regular flex cursor-pointer items-center gap-1 rounded-lg px-3 py-1.5 text-text-secondary hover:bg-state-base-hover'>
              {t('share.chat.memory.operations.edit')}
              <RiCheckLine className='h-4 w-4 text-text-accent' />
            </div>
            <div className='system-md-regular flex cursor-pointer items-center gap-1 rounded-lg px-3 py-1.5 text-text-secondary hover:bg-state-base-hover'>
              {t('share.chat.memory.operations.edit')}
              <RiCheckLine className='h-4 w-4 text-text-accent' />
            </div>
          </div>
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}
export default React.memo(OperationDropdown)
