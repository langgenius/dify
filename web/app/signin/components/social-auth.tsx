import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'next/navigation'
import style from '../page.module.css'
import Button from '@/app/components/base/button'
import { API_PREFIX } from '@/config'
import classNames from '@/utils/classnames'
import { getPurifyHref } from '@/utils'
import { useGlobalPublicStore } from '@/context/global-public-context'

type SocialAuthProps = {
  disabled?: boolean
}

export default function SocialAuth(props: SocialAuthProps) {
  const { t } = useTranslation()
  const searchParams = useSearchParams()
  const systemFeatures = useGlobalPublicStore(state => state.systemFeatures)

  const getOAuthLink = (href: string) => {
    const url = getPurifyHref(`${API_PREFIX}${href}`)
    if (searchParams.has('invite_token'))
      return `${url}?${searchParams.toString()}`

    return url
  }

  const oauthProviders = systemFeatures.oauth_providers || []

  const providerConfigs = [
    {
      name: 'github',
      url: '/oauth/login/github',
      iconClass: style.githubIcon,
      label: t('login.withGitHub'),
    },
    {
      name: 'google',
      url: '/oauth/login/google',
      iconClass: style.googleIcon,
      label: t('login.withGoogle'),
    },
    {
      name: 'microsoft',
      url: '/oauth/login/microsoft',
      iconClass: style.microsoftIcon,
      label: t('login.withMicrosoft'),
    },
    {
      name: 'dingtalk',
      url: '/oauth/login/dingtalk',
      iconClass: style.dingtalkIcon,
      label: t('login.withDingTalk'),
    },
    {
      name: 'canvas',
      url: '/oauth/login/canvas',
      iconClass: style.canvasIcon,
      label: t('login.withCanvas'),
    },
  ]

  const enabledProviders = providerConfigs.filter(provider =>
    oauthProviders.includes(provider.name),
  )

  return <>
    {enabledProviders.map(provider => (
      <div key={provider.name} className='w-full'>
        <a href={getOAuthLink(provider.url)}>
          <Button
            disabled={props.disabled}
            className='w-full'
          >
            <>
              <span className={
                classNames(
                  provider.iconClass,
                  'mr-2 h-5 w-5',
                )
              } />
              <span className="truncate leading-normal">{provider.label}</span>
            </>
          </Button>
        </a>
      </div>
    ))}
  </>
}
