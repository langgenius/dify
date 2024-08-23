import { useTranslation } from 'react-i18next'
import style from '../page.module.css'
import Button from '@/app/components/base/button'
import { apiPrefix } from '@/config'
import { getPurifyHref } from '@/utils'
import classNames from '@/utils/classnames'

type SocialAuthProps = {
  disabled?: boolean
}

export default function SocialAuth(props: SocialAuthProps) {
  const { t } = useTranslation()
  return <>
    <div className='w-full'>
      <a href={getPurifyHref(`${apiPrefix}/oauth/login/github`)}>
        <Button
          disabled={props.disabled}
          className='w-full hover:!bg-gray-50'
        >
          <>
            <span className={
              classNames(
                style.githubIcon,
                'w-5 h-5 mr-2',
              )
            } />
            <span className="truncate text-gray-800">{t('login.withGitHub')}</span>
          </>
        </Button>
      </a>
    </div>
    <div className='w-full'>
      <a href={getPurifyHref(`${apiPrefix}/oauth/login/google`)}>
        <Button
          disabled={props.disabled}
          className='w-full hover:!bg-gray-50'
        >
          <>
            <span className={
              classNames(
                style.googleIcon,
                'w-5 h-5 mr-2',
              )
            } />
            <span className="truncate text-gray-800">{t('login.withGoogle')}</span>
          </>
        </Button>
      </a>
    </div>
  </>
}
