'use client'
import type { FC } from 'react'
import React, { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiEqualizer2Line,
} from '@remixicon/react'
import ActionButton from '@/app/components/base/action-button'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import InfoModal from './info-modal'
import type { SiteInfo } from '@/models/share'
import cn from '@/utils/classnames'

type Props = {
  data: SiteInfo
}

const MenuDropdown: FC<Props> = ({
  data,
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

  const [show, setShow] = useState(false)

  return (
    <>
      <PortalToFollowElem
        open={open}
        onOpenChange={setOpen}
        placement='bottom-end'
      >
        <PortalToFollowElemTrigger onClick={handleTrigger}>
          <div>
            <ActionButton className={cn(open && 'bg-state-base-hover')}>
              <RiEqualizer2Line className='w-4 h-4' />
            </ActionButton>
          </div>
        </PortalToFollowElemTrigger>
        <PortalToFollowElemContent className='z-50'>
          <div className='w-[224px] bg-components-panel-bg-blur rounded-xl border-[0.5px] border-components-panel-border shadow-lg'>
            <div className='p-1'>
              {data.privacy_policy && (
                <a href={data.privacy_policy} target='_blank' className='flex items-center px-3 py-1.5 rounded-lg text-text-secondary system-md-regular cursor-pointer hover:bg-state-base-hover'>
                  <span className='grow'>{t('share.chat.privacyPolicyMiddle')}</span>
                </a>
              )}
              <div
                onClick={() => {
                  handleTrigger()
                  setShow(true)
                }}
                className='px-3 py-1.5 rounded-lg text-text-secondary system-md-regular cursor-pointer hover:bg-state-base-hover'
              >{t('common.userProfile.about')}</div>
            </div>
          </div>
        </PortalToFollowElemContent>
      </PortalToFollowElem>
      {show && (
        <InfoModal
          isShow={show}
          onClose={() => {
            setShow(false)
          }}
          data={data}
        />
      )}
    </>
  )
}
export default React.memo(MenuDropdown)
