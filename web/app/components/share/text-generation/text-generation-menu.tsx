'use client'
import type { MenuContentProps } from '@langgenius/dify-ui/menu'
import type { SiteInfo } from '@/models/share'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import {
  Menu,
  MenuContent,
  MenuGroupLabel,
  MenuItem,
  MenuLinkItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from '@langgenius/dify-ui/menu'
import { useTheme } from 'next-themes'
import * as React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useWebAppStore } from '@/context/web-app-context'
import { AccessMode } from '@/models/access-control'
import { usePathname, useRouter } from '@/next/navigation'
import { resolveWebAppAddress } from '@/service/webapp-address'
import { webAppLogout } from '@/service/webapp-auth'
import InfoModal from './info-modal'

type Props = Readonly<
  Pick<MenuContentProps, 'side' | 'align'> & {
    data?: SiteInfo
    hideLogout?: boolean
  }
>

function TextGenerationMenu({ data, side, align, hideLogout }: Props) {
  const webAppAccessMode = useWebAppStore((s) => s.webAppAccessMode)
  const router = useRouter()
  const pathname = usePathname()
  const { t } = useTranslation(['common', 'share'])

  const handleLogout = async () => {
    await webAppLogout(resolveWebAppAddress())
    router.replace(`/webapp-signin?redirect_url=${pathname}`)
  }

  const { theme, setTheme } = useTheme()
  const [show, setShow] = useState(false)
  const handleOpenInfoModal = () => {
    queueMicrotask(() => {
      setShow(true)
    })
  }

  return (
    <>
      <Menu>
        <MenuTrigger
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
        <MenuContent side={side} align={align} className="w-56">
          <MenuRadioGroup
            value={theme ?? 'system'}
            onValueChange={setTheme}
            className="flex items-center gap-2 px-3 system-md-regular text-text-secondary"
          >
            <MenuGroupLabel className="grow px-0 py-0 system-md-regular text-text-secondary normal-case">
              {t(($) => $['theme.theme'], { ns: 'common' })}
            </MenuGroupLabel>
            <div className="flex items-center rounded-[10px] bg-components-segmented-control-bg-normal p-0.5">
              {(['system', 'light', 'dark'] as const).map((value, index) => (
                <React.Fragment key={value}>
                  {index > 0 && (
                    <div
                      aria-hidden
                      className={
                        (index === 1 && theme === 'dark') ||
                        (index === 2 && (theme ?? 'system') === 'system')
                          ? 'h-3.5 w-px bg-divider-regular'
                          : 'h-3.5 w-px bg-transparent'
                      }
                    />
                  )}
                  <MenuRadioItem
                    value={value}
                    aria-label={t(
                      ($) =>
                        $[
                          value === 'system'
                            ? 'theme.auto'
                            : value === 'light'
                              ? 'theme.light'
                              : 'theme.dark'
                        ],
                      { ns: 'common' },
                    )}
                    className="mx-0 h-auto py-1 text-text-tertiary data-checked:bg-components-segmented-control-item-active-bg data-checked:text-text-accent-light-mode-only data-checked:shadow-sm data-highlighted:text-text-secondary data-checked:data-highlighted:bg-components-segmented-control-item-active-bg data-checked:data-highlighted:text-text-accent-light-mode-only"
                  >
                    <span aria-hidden className="p-0.5">
                      <span
                        className={
                          value === 'system'
                            ? 'i-ri-computer-line size-4'
                            : value === 'light'
                              ? 'i-ri-sun-line size-4'
                              : 'i-ri-moon-line size-4'
                        }
                      />
                    </span>
                  </MenuRadioItem>
                </React.Fragment>
              ))}
            </div>
          </MenuRadioGroup>
          <MenuSeparator />
          {data?.privacy_policy && (
            <MenuLinkItem
              className="system-md-regular"
              href={data.privacy_policy}
              target="_blank"
              rel="noreferrer"
            >
              <span className="grow">
                {t(($) => $['chat.privacyPolicyMiddle'], { ns: 'share' })}
              </span>
            </MenuLinkItem>
          )}
          <MenuItem className="system-md-regular" onClick={handleOpenInfoModal}>
            {t(($) => $['userProfile.about'], { ns: 'common' })}
          </MenuItem>
          {!(
            hideLogout ||
            webAppAccessMode === AccessMode.EXTERNAL_MEMBERS ||
            webAppAccessMode === AccessMode.PUBLIC
          ) && (
            <MenuItem className="system-md-regular" onClick={handleLogout}>
              {t(($) => $['userProfile.logout'], { ns: 'common' })}
            </MenuItem>
          )}
        </MenuContent>
      </Menu>
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
export default React.memo(TextGenerationMenu)
