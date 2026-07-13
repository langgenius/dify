import { useTranslation } from 'react-i18next'
import DifyLogo from '@/app/components/base/logo/dify-logo'

type BrandingFooterProps = {
  removeWebappBrand?: boolean
  replaceWebappLogo?: string | null
}

const BrandingFooter = ({ removeWebappBrand, replaceWebappLogo }: BrandingFooterProps) => {
  const { t } = useTranslation()

  if (removeWebappBrand) return null

  return (
    <div className="flex flex-row-reverse px-2 py-3">
      <div className="flex shrink-0 items-center gap-1.5 px-1">
        <div className="system-2xs-medium-uppercase text-text-tertiary">
          {t(($) => $['chat.poweredBy'], { ns: 'share' })}
        </div>
        {replaceWebappLogo ? (
          <img src={replaceWebappLogo} alt="logo" className="block h-5 w-auto" />
        ) : (
          <DifyLogo size="small" />
        )}
      </div>
    </div>
  )
}

export default BrandingFooter
