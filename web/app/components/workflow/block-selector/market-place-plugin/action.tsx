'use client'
import type { FC } from 'react'
import React, { useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { RiMoreFill } from '@remixicon/react'
import ActionButton from '@/app/components/base/action-button'
// import Button from '@/app/components/base/button'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import cn from '@/utils/classnames'
import { MARKETPLACE_URL_PREFIX } from '@/config'

type Props = {
  open: boolean
  onOpenChange: (v: boolean) => void
  author: string
  name: string
}

const OperationDropdown: FC<Props> = ({
  open,
  onOpenChange,
  author,
  name,
}) => {
  const { t } = useTranslation()
  const openRef = useRef(open)
  const setOpen = useCallback((v: boolean) => {
    onOpenChange(v)
    openRef.current = v
  }, [onOpenChange])

  const handleTrigger = useCallback(() => {
    setOpen(!openRef.current)
  }, [setOpen])

  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement='bottom-end'
      offset={{
        mainAxis: 0,
        crossAxis: 0,
      }}
    >
      <PortalToFollowElemTrigger onClick={handleTrigger}>
        <ActionButton className={cn(open && 'bg-state-base-hover')}>
          <RiMoreFill className='w-4 h-4 text-components-button-secondary-accent-text' />
        </ActionButton>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className='z-[9999]'>
        <div className='w-[112px] p-1 bg-components-panel-bg-blur rounded-xl border-[0.5px] border-components-panel-border shadow-lg'>
          <div className='px-3 py-1.5 rounded-lg text-text-secondary system-md-regular cursor-pointer hover:bg-state-base-hover'>{t('common.operation.download')}</div>
          <a href={`${MARKETPLACE_URL_PREFIX}/plugins/${author}/${name}`} target='_blank' className='block px-3 py-1.5 rounded-lg text-text-secondary system-md-regular cursor-pointer hover:bg-state-base-hover'>{t('common.operation.viewDetails')}</a>
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}
export default React.memo(OperationDropdown)
