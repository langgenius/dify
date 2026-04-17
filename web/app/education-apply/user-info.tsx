import { useTranslation } from 'react-i18next'
import { Triangle } from '@/app/components/base/icons/src/public/education'
import { Avatar } from '@/app/components/base/ui/avatar'
import { Button } from '@/app/components/base/ui/button'
import { useAppContext } from '@/context/app-context'
import { useRouter } from '@/next/navigation'
import { useLogout } from '@/service/use-common'

const UserInfo = () => {
  const router = useRouter()
  const { t } = useTranslation()
  const { userProfile } = useAppContext()

  const { mutateAsync: logout } = useLogout()
  const handleLogout = async () => {
    await logout()

    localStorage.removeItem('setup_status')
    // Tokens are now stored in cookies and cleared by backend

    router.push('/signin')
  }

  return (
    <div className="relative flex items-center justify-between rounded-xl border-4 border-components-panel-on-panel-item-bg bg-linear-to-r from-background-gradient-bg-fill-chat-bg-2 to-background-gradient-bg-fill-chat-bg-1 pt-9 pr-8 pb-6 pl-6 shadow-shadow-shadow-5">
      <div className="absolute top-0 left-0 flex items-center">
        <div className="flex h-[22px] items-center bg-components-panel-on-panel-item-bg pt-1 pl-2 system-2xs-semibold-uppercase text-text-accent-light-mode-only">
          {t('currentSigned', { ns: 'education' })}
        </div>
        <Triangle className="h-[22px] w-4 text-components-panel-on-panel-item-bg" />
      </div>
      <div className="flex items-center">
        <Avatar
          className="mr-4"
          avatar={userProfile.avatar_url}
          name={userProfile.name}
          size="2xl"
        />
        <div className="pt-1.5">
          <div className="system-md-semibold text-text-primary">
            {userProfile.name}
          </div>
          <div className="system-sm-regular text-text-secondary">
            {userProfile.email}
          </div>
        </div>
      </div>
      <Button
        variant="secondary"
        onClick={handleLogout}
      >
        {t('userProfile.logout', { ns: 'common' })}
      </Button>
    </div>
  )
}

export default UserInfo
