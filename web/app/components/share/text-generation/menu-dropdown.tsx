'use client'
import type { FC } from 'react'
import React, { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Placement } from '@floating-ui/react'
import {
  RiEqualizer2Line,
} from '@remixicon/react'
import { useRouter } from 'next/navigation'
import Divider from '../../base/divider'
import { removeAccessToken } from '../utils'
import InfoModal from './info-modal'
import ActionButton from '@/app/components/base/action-button'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import type { SiteInfo } from '@/models/share'
import cn from '@/utils/classnames'

type Props = {
  data?: SiteInfo
  placement?: Placement
  hideLogout?: boolean
}

const MenuDropdown: FC<Props> = ({
  data,
  placement,
  hideLogout,
}) => {
  const router = useRouter()
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

  const handleLogout = useCallback(() => {
    removeAccessToken()
    router.replace(`/webapp-signin?redirect_url=${window.location.href}`)
  }, [router])

  const [show, setShow] = useState(false)

  return (
    <>
      <PortalToFollowElem
        open={open}
        onOpenChange={setOpen}
        placement={placement || 'bottom-end'}
        offset={{
          mainAxis: 4,
          crossAxis: -4,
        }}
      >
        <PortalToFollowElemTrigger onClick={handleTrigger}>
          <div>
            <ActionButton size='l' className={cn(open && 'bg-state-base-hover')}>
              <RiEqualizer2Line className='h-[18px] w-[18px]' />
            </ActionButton>
          </div>
        </PortalToFollowElemTrigger>
        <PortalToFollowElemContent className='z-50'>
          <div className='w-[224px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg backdrop-blur-sm'>
            <div className='p-1'>
              {data?.privacy_policy && (
                <a href={data.privacy_policy} target='_blank' className='system-md-regular flex cursor-pointer items-center rounded-lg px-3 py-1.5 text-text-secondary hover:bg-state-base-hover'>
                  <span className='grow'>{t('share.chat.privacyPolicyMiddle')}</span>
                </a>
              )}
              <div
                onClick={() => {
                  handleTrigger()
                  setShow(true)
                }}
                className='system-md-regular cursor-pointer rounded-lg px-3 py-1.5 text-text-secondary hover:bg-state-base-hover'
              >{t('common.userProfile.about')}</div>
              {false && (
                <>
                  <Divider />
                  <div
                    onClick={() => {
                      handleLogout()
                    }}
                    className='system-md-regular cursor-pointer rounded-lg px-3 py-1.5 text-text-destructive hover:bg-state-base-hover'
                  >{t('common.userProfile.logout')}</div>
                </>
              )}
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
