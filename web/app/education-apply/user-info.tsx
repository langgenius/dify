import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import Avatar from '@/app/components/base/avatar'
import Button from '@/app/components/base/button'
import { Triangle } from '@/app/components/base/icons/src/public/education'
import { useAppContext } from '@/context/app-context'
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
    <div className="relative flex items-center justify-between rounded-xl border-[4px] border-components-panel-on-panel-item-bg bg-gradient-to-r from-background-gradient-bg-fill-chat-bg-2 to-background-gradient-bg-fill-chat-bg-1 pb-6 pl-6 pr-8 pt-9 shadow-shadow-shadow-5">
      <div className="absolute left-0 top-0 flex items-center">
        <div className="flex h-[22px] items-center bg-components-panel-on-panel-item-bg pl-2 pt-1 text-text-accent-light-mode-only system-2xs-semibold-uppercase">
          {t('currentSigned', { ns: 'education' })}
        </div>
        <Triangle className="h-[22px] w-4 text-components-panel-on-panel-item-bg" />
      </div>
      <div className="flex items-center">
        <Avatar
          className="mr-4"
          avatar={userProfile.avatar_url}
          name={userProfile.name}
          size={48}
        />
        <div className="pt-1.5">
          <div className="text-text-primary system-md-semibold">
            {userProfile.name}
          </div>
          <div className="text-text-secondary system-sm-regular">
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
