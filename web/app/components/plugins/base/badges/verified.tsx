import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import IconWithTooltip from './icon-with-tooltip'
import VerifiedDark from '@/app/components/base/icons/src/public/plugins/VerifiedDark'
import VerifiedLight from '@/app/components/base/icons/src/public/plugins/VerifiedLight'
import useTheme from '@/hooks/use-theme'

type VerifiedProps = {
  className?: string
}

const Verified: FC<VerifiedProps> = ({
  className,
}) => {
  const { t } = useTranslation()
  const { theme } = useTheme()

  return (
    <IconWithTooltip
      className={className}
      theme={theme}
      BadgeIconLight={VerifiedLight}
      BadgeIconDark={VerifiedDark}
      popupContent={t('plugin.marketplace.verifiedTip')}
    />
  )
}

export default Verified
