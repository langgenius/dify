'use client'
import type { DropdownMenuContentProps } from '@langgenius/dify-ui/dropdown-menu'
import type { SiteInfo } from '@/models/share'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroupLabel,
  DropdownMenuItem,
  DropdownMenuLinkItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { useTheme } from 'next-themes'
import * as React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useWebAppStore } from '@/context/web-app-context'
import { AccessMode } from '@/models/access-control'
import { usePathname, useRouter } from '@/next/navigation'
import { resolveWebAppAddress } from '@/service/webapp-address'
import { webAppLogout } from '@/service/webapp-auth'
import { AppInfoDialog } from './info-modal'

type Props = Readonly<
  Pick<DropdownMenuContentProps, 'placement'> & {
    data?: SiteInfo
    hideLogout?: boolean
  }
>

function MenuDropdown({ data, placement, hideLogout }: Props) {
  const webAppAccessMode = useWebAppStore((s) => s.webAppAccessMode)
  const router = useRouter()
  const pathname = usePathname()
  const { t } = useTranslation(['common', 'share'])

  const handleLogout = async () => {
    await webAppLogout(resolveWebAppAddress())
    router.replace(`/webapp-signin?redirect_url=${pathname}`)
  }

  const { theme, setTheme } = useTheme()
  const [isInfoOpen, setIsInfoOpen] = useState(false)

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
        <DropdownMenuContent placement={placement || 'bottom-end'} sideOffset={4} className="w-56">
          <DropdownMenuRadioGroup
            value={theme ?? 'system'}
            onValueChange={setTheme}
            className="flex items-center gap-2 px-3 system-md-regular text-text-secondary"
          >
            <DropdownMenuGroupLabel className="grow px-0 py-0 system-md-regular text-text-secondary normal-case">
              {t(($) => $['theme.theme'], { ns: 'common' })}
            </DropdownMenuGroupLabel>
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
                  <DropdownMenuRadioItem
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
                  </DropdownMenuRadioItem>
                </React.Fragment>
              ))}
            </div>
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          {data?.privacy_policy && (
            <DropdownMenuLinkItem
              className="system-md-regular"
              href={data.privacy_policy}
              target="_blank"
              rel="noreferrer"
            >
              <span className="grow">
                {t(($) => $['chat.privacyPolicyMiddle'], { ns: 'share' })}
              </span>
            </DropdownMenuLinkItem>
          )}
          <DropdownMenuItem className="system-md-regular" onClick={() => setIsInfoOpen(true)}>
            {t(($) => $['userProfile.about'], { ns: 'common' })}
          </DropdownMenuItem>
          {!(
            hideLogout ||
            webAppAccessMode === AccessMode.EXTERNAL_MEMBERS ||
            webAppAccessMode === AccessMode.PUBLIC
          ) && (
            <DropdownMenuItem className="system-md-regular" onClick={handleLogout}>
              {t(($) => $['userProfile.logout'], { ns: 'common' })}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <AppInfoDialog open={isInfoOpen} onOpenChange={setIsInfoOpen} data={data} />
    </>
  )
}
export default React.memo(MenuDropdown)
