import type { FC } from 'react'
import type { CustomConfigValueType } from '@/models/share'
import { useTranslation } from 'react-i18next'
import DifyLogo from '@/app/components/base/logo/dify-logo'
import { useGlobalPublicStore } from '@/context/global-public-context'
import { cn } from '@/utils/classnames'

type PoweredByProps = {
  isPC: boolean
  resultExisted: boolean
  customConfig: Record<string, CustomConfigValueType> | null
}

const PoweredBy: FC<PoweredByProps> = ({ isPC, resultExisted, customConfig }) => {
  const { t } = useTranslation()
  const systemFeatures = useGlobalPublicStore(s => s.systemFeatures)

  if (customConfig?.remove_webapp_brand)
    return null

  const brandingLogo = systemFeatures.branding.enabled ? systemFeatures.branding.workspace_logo : undefined
  const customLogo = customConfig?.replace_webapp_logo
  const logoSrc = brandingLogo || (typeof customLogo === 'string' ? customLogo : undefined)

  return (
    <div className={cn(
      'flex shrink-0 items-center gap-1.5 bg-components-panel-bg py-3',
      isPC ? 'px-8' : 'px-4',
      !isPC && resultExisted && 'rounded-b-2xl border-b-[0.5px] border-divider-regular',
    )}
    >
      <div className="system-2xs-medium-uppercase text-text-tertiary">{t('chat.poweredBy', { ns: 'share' })}</div>
      {logoSrc
        ? <img src={logoSrc} alt="logo" className="block h-5 w-auto" />
        : <DifyLogo size="small" />}
    </div>
  )
}

export default PoweredBy
