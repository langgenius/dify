import { useSearchParams } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import { API_PREFIX } from '@/config'
import { getPurifyHref } from '@/utils'
import { cn } from '@/utils/classnames'
import style from '../page.module.css'

type SocialAuthProps = {
  disabled?: boolean
}

export default function SocialAuth(props: SocialAuthProps) {
  const { t } = useTranslation()
  const searchParams = useSearchParams()

  const getOAuthLink = (href: string) => {
    const url = getPurifyHref(`${API_PREFIX}${href}`)
    if (searchParams.has('invite_token'))
      return `${url}?${searchParams.toString()}`

    return url
  }
  return (
    <>
      <div className="w-full">
        <a href={getOAuthLink('/oauth/login/github')}>
          <Button
            disabled={props.disabled}
            className="w-full"
          >
            <>
              <span className={
                cn(style.githubIcon, 'mr-2 h-5 w-5')
              }
              />
              <span className="truncate leading-normal">{t('withGitHub', { ns: 'login' })}</span>
            </>
          </Button>
        </a>
      </div>
      <div className="w-full">
        <a href={getOAuthLink('/oauth/login/google')}>
          <Button
            disabled={props.disabled}
            className="w-full"
          >
            <>
              <span className={
                cn(style.googleIcon, 'mr-2 h-5 w-5')
              }
              />
              <span className="truncate leading-normal">{t('withGoogle', { ns: 'login' })}</span>
            </>
          </Button>
        </a>
      </div>
    </>
  )
}
