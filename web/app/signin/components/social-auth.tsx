import { buttonVariants } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from 'react-i18next'
import { API_PREFIX } from '@/config'
import { useLocale } from '@/context/i18n'
import { useSearchParams } from '@/next/navigation'
import { getPurifyHref } from '@/utils'
import { getBrowserTimezone } from '@/utils/timezone'
import style from '../page.module.css'

export default function SocialAuth() {
  const { t } = useTranslation()
  const searchParams = useSearchParams()
  const locale = useLocale()

  const getOAuthLink = (href: string) => {
    const url = getPurifyHref(`${API_PREFIX}${href}`)
    const params = new URLSearchParams(searchParams.toString())
    const timezone = getBrowserTimezone()
    if (timezone) params.set('timezone', timezone)
    params.set('language', locale)

    const query = params.toString()
    if (query) return `${url}?${query}`

    return url
  }
  return (
    <>
      <a className={cn(buttonVariants(), 'w-full')} href={getOAuthLink('/oauth/login/github')}>
        <span aria-hidden="true" className={cn(style.githubIcon, 'size-5')} />
        <span className="truncate leading-normal">{t(($) => $.withGitHub, { ns: 'login' })}</span>
      </a>
      <a className={cn(buttonVariants(), 'w-full')} href={getOAuthLink('/oauth/login/google')}>
        <span aria-hidden="true" className={cn(style.googleIcon, 'size-5')} />
        <span className="truncate leading-normal">{t(($) => $.withGoogle, { ns: 'login' })}</span>
      </a>
    </>
  )
}
