import { useTranslation } from 'react-i18next'
import { useRouter } from 'next/navigation'
import Button from '@/app/components/base/button'
import { useAppContext } from '@/context/app-context'
import { logout } from '@/service/common'
import Avatar from '@/app/components/base/avatar'

const UserInfo = () => {
  const router = useRouter()
  const { t } = useTranslation()
  const { userProfile } = useAppContext()

  const handleLogout = async () => {
    await logout({
      url: '/logout',
      params: {},
    })

    localStorage.removeItem('setup_status')
    localStorage.removeItem('console_token')
    localStorage.removeItem('refresh_token')

    router.push('/signin')
  }

  return (
    <div className='flex items-center justify-between pl-6 pt-9 pr-8 pb-6 bg-gradient-to-r from-background-gradient-bg-fill-chat-bg-2 to-background-gradient-bg-fill-chat-bg-1 border-[4px] border-components-panel-on-panel-item-bg rounded-xl shadow-shadow-shadow-5'>
      <div className='flex items-center'>
        <Avatar
          className='mr-4'
          avatar={userProfile.avatar_url}
          name={userProfile.name}
          size={48}
        />
        <div className='pt-1.5'>
          <div className='system-md-semibold text-text-primary'>
            {userProfile.name}
          </div>
          <div className='system-sm-regular text-text-secondary'>
            {userProfile.email}
          </div>
        </div>
      </div>
      <Button
        variant='secondary'
        onClick={handleLogout}
      >
        {t('common.userProfile.logout')}
      </Button>
    </div>
  )
}

export default UserInfo
