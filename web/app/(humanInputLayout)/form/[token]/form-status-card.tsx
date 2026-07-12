import type { ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from 'react-i18next'
import BrandingFooter from './branding-footer'

type FormStatusCardProps = {
  iconClassName: string
  title: ReactNode
  subtitle?: ReactNode
  submissionID?: string
  removeWebappBrand?: boolean
  replaceWebappLogo?: string | null
}

const FormStatusCard = ({
  iconClassName,
  title,
  subtitle,
  submissionID,
  removeWebappBrand,
  replaceWebappLogo,
}: FormStatusCardProps) => {
  const { t } = useTranslation()

  return (
    <div className={cn('flex size-full flex-col items-center justify-center')}>
      <div className="max-w-160 min-w-120">
        <div className="flex h-80 flex-col gap-4 rounded-[20px] border border-divider-subtle bg-chat-bubble-bg p-10 pb-9 shadow-lg backdrop-blur-xs">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-components-panel-border-subtle bg-background-default-dodge p-3">
            <span className={cn('size-8', iconClassName)} />
          </div>
          <div className="grow">
            <div className="title-4xl-semi-bold text-text-primary">{title}</div>
            {!!subtitle && <div className="title-4xl-semi-bold text-text-primary">{subtitle}</div>}
          </div>
          {submissionID && (
            <div className="shrink-0 system-2xs-regular-uppercase text-text-tertiary">
              {t(($) => $['humanInput.submissionID'], { id: submissionID, ns: 'share' })}
            </div>
          )}
        </div>
        <BrandingFooter
          removeWebappBrand={removeWebappBrand}
          replaceWebappLogo={replaceWebappLogo}
        />
      </div>
    </div>
  )
}

export default FormStatusCard
