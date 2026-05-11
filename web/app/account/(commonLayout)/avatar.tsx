'use client'
import { Avatar } from '@langgenius/dify-ui/avatar'
import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { resetUser } from '@/app/components/base/amplitude/utils'
import { LogOut01 } from '@/app/components/base/icons/src/vender/line/general'
import PremiumBadge from '@/app/components/base/premium-badge'
import { useProviderContext } from '@/context/provider-context'
import { useRouter } from '@/next/navigation'
import { useLogout, userProfileQueryOptions } from '@/service/use-common'

export default function AppSelector() {
  const router = useRouter()
  const { t } = useTranslation()
  // Cache is warmed by AppContextProvider's useSuspenseQuery; this hits cache synchronously.
  const { data: userProfileResp } = useSuspenseQuery(userProfileQueryOptions())
  const userProfile = userProfileResp.profile
  const { isEducationAccount } = useProviderContext()

  const { mutateAsync: logout } = useLogout()

  if (!userProfile)
    return null

  const handleLogout = async () => {
    await logout()

    localStorage.removeItem('setup_status')
    resetUser()
    // Tokens are now stored in cookies and cleared by backend

    router.push('/signin')
  }

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        aria-label={userProfile.name}
        className={cn(
          'inline-flex items-center rounded-[20px] text-sm text-text-primary outline-hidden mobile:px-1',
          'hover:bg-components-panel-bg-blur focus-visible:bg-components-panel-bg-blur focus-visible:ring-1 focus-visible:ring-components-input-border-hover data-popup-open:bg-components-panel-bg-blur',
        )}
      >
        <Avatar avatar={userProfile.avatar_url} name={userProfile.name} />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        placement="bottom-end"
        sideOffset={4}
        popupClassName="w-60 max-w-80 divide-y divide-divider-subtle bg-components-panel-bg-blur p-0"
      >
        <div className="p-1">
          <div className="flex flex-nowrap items-center px-3 py-2">
            <div className="min-w-0 grow">
              <div className="system-md-medium break-all text-text-primary">
                {userProfile.name}
                {isEducationAccount && (
                  <PremiumBadge size="s" color="blue" className="ml-1 px-2!">
                    <span aria-hidden="true" className="mr-1 i-ri-graduation-cap-fill h-3 w-3" />
                    <span className="system-2xs-medium">EDU</span>
                  </PremiumBadge>
                )}
              </div>
              <div className="system-xs-regular break-all text-text-tertiary">{userProfile.email}</div>
            </div>
            <Avatar avatar={userProfile.avatar_url} name={userProfile.name} />
          </div>
        </div>
        <div className="p-1">
          <DropdownMenuItem
            className="h-9 justify-start px-3"
            onClick={handleLogout}
          >
            <LogOut01 className="mr-1 flex h-4 w-4 text-text-tertiary" />
            <span className="text-[14px] font-normal text-text-secondary">{t('userProfile.logout', { ns: 'common' })}</span>
          </DropdownMenuItem>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
