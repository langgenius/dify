import type { ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from 'react-i18next'
import DifyLogo from '@/app/components/base/logo/dify-logo'

type FormStatusCardProps = {
  iconClassName: string
  title: ReactNode
  subtitle?: ReactNode
  submissionID?: string
}

const FormStatusCard = ({
  iconClassName,
  title,
  subtitle,
  submissionID,
}: FormStatusCardProps) => {
  const { t } = useTranslation()

  return (
    <div className={cn('flex h-full w-full flex-col items-center justify-center')}>
      <div className="max-w-[640px] min-w-[480px]">
        <div className="flex h-[320px] flex-col gap-4 rounded-[20px] border border-divider-subtle bg-chat-bubble-bg p-10 pb-9 shadow-lg backdrop-blur-xs">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-components-panel-border-subtle bg-background-default-dodge p-3">
            <span className={cn('h-8 w-8', iconClassName)} />
          </div>
          <div className="grow">
            <div className="title-4xl-semi-bold text-text-primary">{title}</div>
            {subtitle && (
              <div className="title-4xl-semi-bold text-text-primary">{subtitle}</div>
            )}
          </div>
          {submissionID && (
            <div className="shrink-0 system-2xs-regular-uppercase text-text-tertiary">
              {t('humanInput.submissionID', { id: submissionID, ns: 'share' })}
            </div>
          )}
        </div>
        <div className="flex flex-row-reverse px-2 py-3">
          <div className="flex shrink-0 items-center gap-1.5 px-1">
            <div className="system-2xs-medium-uppercase text-text-tertiary">{t('chat.poweredBy', { ns: 'share' })}</div>
            <DifyLogo size="small" />
          </div>
        </div>
      </div>
    </div>
  )
}

export default FormStatusCard
