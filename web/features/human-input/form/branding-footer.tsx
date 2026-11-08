import { useTranslation } from 'react-i18next'
import { DifyLogo } from '@/app/components/base/logo/dify-logo'

type BrandingFooterProps = {
  variant?: 'form' | 'status' | 'legacy-status'
  removeWebappBrand?: boolean
  replaceWebappLogo?: string | null
}

const BrandingFooter = ({
  variant = 'form',
  removeWebappBrand,
  replaceWebappLogo,
}: BrandingFooterProps) => {
  const { t } = useTranslation(['share'])

  if (removeWebappBrand) return null

  return (
    <div
      data-variant={variant}
      className="flex flex-row-reverse px-2 py-3 data-[variant=legacy-status]:px-1"
    >
      <div
        data-variant={variant}
        className="flex shrink-0 items-center gap-1.5 data-[variant=legacy-status]:gap-2 data-[variant=status]:gap-2"
      >
        <div className="system-2xs-medium-uppercase text-text-tertiary">
          {t(($) => $['chat.poweredBy'], { ns: 'share' })}
        </div>
        {replaceWebappLogo ? (
          <img src={replaceWebappLogo} alt="logo" className="block h-5 w-auto" />
        ) : (
          <DifyLogo alt="Dify" size="small" />
        )}
      </div>
    </div>
  )
}

export default BrandingFooter
