'use client'
import type { Placement } from '@floating-ui/react'
import type { FC } from 'react'
import type { SiteInfo } from '@/models/share'
import {
  RiEqualizer2Line,
} from '@remixicon/react'
import { usePathname, useRouter } from 'next/navigation'
import * as React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ActionButton from '@/app/components/base/action-button'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import ThemeSwitcher from '@/app/components/base/theme-switcher'
import { useWebAppStore } from '@/context/web-app-context'
import { AccessMode } from '@/models/access-control'
import { webAppLogout } from '@/service/webapp-auth'
import { cn } from '@/utils/classnames'
import Divider from '../../base/divider'
import InfoModal from './info-modal'

type Props = {
  data?: SiteInfo
  placement?: Placement
  hideLogout?: boolean
  forceClose?: boolean
}

const MenuDropdown: FC<Props> = ({
  data,
  placement,
  hideLogout,
  forceClose,
}) => {
  const webAppAccessMode = useWebAppStore(s => s.webAppAccessMode)
  const router = useRouter()
  const pathname = usePathname()
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

  const shareCode = useWebAppStore(s => s.shareCode)
  const handleLogout = useCallback(async () => {
    await webAppLogout(shareCode!)
    router.replace(`/webapp-signin?redirect_url=${pathname}`)
  }, [router, pathname, webAppLogout, shareCode])

  const [show, setShow] = useState(false)

  useEffect(() => {
    if (forceClose)
      setOpen(false)
  }, [forceClose, setOpen])

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
            <ActionButton size="l" className={cn(open && 'bg-state-base-hover')}>
              <RiEqualizer2Line className="h-[18px] w-[18px]" />
            </ActionButton>
          </div>
        </PortalToFollowElemTrigger>
        <PortalToFollowElemContent className="z-50">
          <div className="w-[224px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg backdrop-blur-sm">
            <div className="p-1">
              <div className={cn('system-md-regular flex cursor-pointer items-center rounded-lg py-1.5 pl-3 pr-2 text-text-secondary')}>
                <div className="grow">{t('theme.theme', { ns: 'common' })}</div>
                <ThemeSwitcher />
              </div>
            </div>
            <Divider type="horizontal" className="my-0" />
            <div className="p-1">
              {data?.privacy_policy && (
                <a href={data.privacy_policy} target="_blank" className="system-md-regular flex cursor-pointer items-center rounded-lg px-3 py-1.5 text-text-secondary hover:bg-state-base-hover">
                  <span className="grow">{t('chat.privacyPolicyMiddle', { ns: 'share' })}</span>
                </a>
              )}
              <div
                onClick={() => {
                  handleTrigger()
                  setShow(true)
                }}
                className="system-md-regular cursor-pointer rounded-lg px-3 py-1.5 text-text-secondary hover:bg-state-base-hover"
              >
                {t('userProfile.about', { ns: 'common' })}
              </div>
            </div>
            {!(hideLogout || webAppAccessMode === AccessMode.EXTERNAL_MEMBERS || webAppAccessMode === AccessMode.PUBLIC) && (
              <div className="p-1">
                <div
                  onClick={handleLogout}
                  className="system-md-regular cursor-pointer rounded-lg px-3 py-1.5 text-text-secondary hover:bg-state-base-hover"
                >
                  {t('userProfile.logout', { ns: 'common' })}
                </div>
              </div>
            )}
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
