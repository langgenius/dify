'use client'
import type { DropdownMenuContentProps } from '@langgenius/dify-ui/dropdown-menu'
import type { FC } from 'react'
import type { SiteInfo } from '@/models/share'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLinkItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import * as React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import ThemeSwitcher from '@/app/components/base/theme-switcher'
import { useWebAppStore } from '@/context/web-app-context'
import { AccessMode } from '@/models/access-control'
import { usePathname, useRouter } from '@/next/navigation'
import { resolveWebAppAddress } from '@/service/webapp-address'
import { webAppLogout } from '@/service/webapp-auth'
import InfoModal from './info-modal'

type Props = Readonly<
  Pick<DropdownMenuContentProps, 'placement'> & {
    data?: SiteInfo
    hideLogout?: boolean
  }
>

const MenuDropdown: FC<Props> = ({ data, placement, hideLogout }) => {
  const webAppAccessMode = useWebAppStore((s) => s.webAppAccessMode)
  const router = useRouter()
  const pathname = usePathname()
  const { t } = useTranslation()

  const handleLogout = async () => {
    await webAppLogout(resolveWebAppAddress())
    router.replace(`/webapp-signin?redirect_url=${pathname}`)
  }

  const [show, setShow] = useState(false)
  const handleOpenInfoModal = () => {
    queueMicrotask(() => {
      setShow(true)
    })
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <IconButton
              aria-label={t(($) => $['operation.more'], { ns: 'common' })}
              size="lg"
              className="data-popup-open:bg-state-base-hover"
            >
              <span aria-hidden className="i-ri-equalizer-2-line h-4.5 w-4.5" />
            </IconButton>
          }
        />
        <DropdownMenuContent
          placement={placement || 'bottom-end'}
          sideOffset={4}
          className="w-[224px]"
        >
          <div className="px-3 py-1.5 system-md-regular text-text-secondary">
            <div className="flex items-center gap-2">
              <div className="grow">{t(($) => $['theme.theme'], { ns: 'common' })}</div>
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
              <span className="grow">
                {t(($) => $['chat.privacyPolicyMiddle'], { ns: 'share' })}
              </span>
            </DropdownMenuLinkItem>
          )}
          <DropdownMenuItem className="px-3 system-md-regular" onClick={handleOpenInfoModal}>
            {t(($) => $['userProfile.about'], { ns: 'common' })}
          </DropdownMenuItem>
          {!(
            hideLogout ||
            webAppAccessMode === AccessMode.EXTERNAL_MEMBERS ||
            webAppAccessMode === AccessMode.PUBLIC
          ) && (
            <DropdownMenuItem className="px-3 system-md-regular" onClick={handleLogout}>
              {t(($) => $['userProfile.logout'], { ns: 'common' })}
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
