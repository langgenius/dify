import { useSearchParams } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import { API_PREFIX } from '@/config'
import { getPurifyHref } from '@/utils'

type AceDataCloudAuthProps = {
  disabled?: boolean
}

export default function AceDataCloudAuth(props: AceDataCloudAuthProps) {
  const { t } = useTranslation()
  const searchParams = useSearchParams()

  const getOAuthLink = () => {
    const url = getPurifyHref(`${API_PREFIX}/oauth/login/acedatacloud`)
    const params = new URLSearchParams(searchParams.toString())
    const queryString = params.toString()
    return queryString ? `${url}?${queryString}` : url
  }

  return (
    <div className="w-full">
      <a href={getOAuthLink()}>
        <Button
          disabled={props.disabled}
          className="w-full"
        >
          <span className="truncate leading-normal">{t('withAceDataCloud', { ns: 'login' })}</span>
        </Button>
      </a>
    </div>
  )
}
