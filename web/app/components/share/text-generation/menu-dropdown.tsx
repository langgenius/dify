'use client'
import type { FC } from 'react'
import type { Placement } from '@/app/components/base/ui/placement'
import type { SiteInfo } from '@/models/share'
import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ActionButton from '@/app/components/base/action-button'
import ThemeSwitcher from '@/app/components/base/theme-switcher'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLinkItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/app/components/base/ui/dropdown-menu'
import { useWebAppStore } from '@/context/web-app-context'
import { AccessMode } from '@/models/access-control'
import { usePathname, useRouter } from '@/next/navigation'
import { webAppLogout } from '@/service/webapp-auth'
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
  const [open, setOpen] = useState(false)

  const shareCode = useWebAppStore(s => s.shareCode)
  const handleLogout = useCallback(async () => {
    setOpen(false)
    await webAppLogout(shareCode!)
    router.replace(`/webapp-signin?redirect_url=${pathname}`)
  }, [pathname, router, setOpen, shareCode])

  const [show, setShow] = useState(false)
  const handleOpenInfoModal = useCallback(() => {
    setOpen(false)
    queueMicrotask(() => {
      setShow(true)
    })
  }, [])

  useEffect(() => {
    if (forceClose)
      setOpen(false)
  }, [forceClose, setOpen])

  return (
    <>
      <DropdownMenu
        open={open}
        onOpenChange={setOpen}
      >
        <DropdownMenuTrigger
          render={<div />}
          aria-label={t('operation.more', { ns: 'common' })}
        >
          <ActionButton size="l" className={cn(open && 'bg-state-base-hover')}>
            <span aria-hidden className="i-ri-equalizer-2-line h-[18px] w-[18px]" />
          </ActionButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          placement={placement || 'bottom-end'}
          sideOffset={4}
          popupClassName="w-[224px]"
        >
          <div className="px-3 py-1.5 system-md-regular text-text-secondary">
            <div className="flex items-center gap-2">
              <div className="grow">{t('theme.theme', { ns: 'common' })}</div>
              <ThemeSwitcher />
            </div>
          </div>
          <DropdownMenuSeparator className="my-0" />
          {data?.privacy_policy && (
            <DropdownMenuLinkItem
              className="px-3 system-md-regular"
              href={data.privacy_policy}
              target="_blank"
              rel="noreferrer"
            >
              <span className="grow">{t('chat.privacyPolicyMiddle', { ns: 'share' })}</span>
            </DropdownMenuLinkItem>
          )}
          <DropdownMenuItem
            className="px-3 system-md-regular"
            onClick={handleOpenInfoModal}
          >
            {t('userProfile.about', { ns: 'common' })}
          </DropdownMenuItem>
          {!(hideLogout || webAppAccessMode === AccessMode.EXTERNAL_MEMBERS || webAppAccessMode === AccessMode.PUBLIC) && (
            <DropdownMenuItem
              className="px-3 system-md-regular"
              onClick={handleLogout}
            >
              {t('userProfile.logout', { ns: 'common' })}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
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
