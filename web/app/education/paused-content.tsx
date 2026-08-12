'use client'

import { buttonVariants } from '@langgenius/dify-ui/button'
import { useTranslation } from 'react-i18next'
import { useDocLink } from '@/context/i18n'
import Link from '@/next/link'
import { EducationStatusCard } from './status-card'
import UserInfo from './user-info'

export function EducationPausedContent() {
  const { t } = useTranslation()
  const docLink = useDocLink()

  return (
    <>
      <div className="mb-7">
        <UserInfo />
      </div>
      <EducationStatusCard
        icon={
          <span
            className="i-ri-pause-circle-fill size-6 text-text-warning-secondary"
            aria-hidden="true"
          />
        }
        title={t(($) => $['educationDiscountPaused.title'], { ns: 'education' })}
        actions={
          <>
            <Link className={buttonVariants({ variant: 'secondary' })} href="/">
              <span className="i-ri-arrow-left-line size-4" aria-hidden="true" />
              {t(($) => $['applied.noPaymentPermission.returnHome'], { ns: 'education' })}
            </Link>
            <a
              className={buttonVariants({ variant: 'ghost-accent' })}
              href={docLink('/use-dify/workspace/subscription-management#dify-for-education')}
              target="_blank"
              rel="noopener noreferrer"
            >
              {t(($) => $.learn, { ns: 'education' })}
              <span className="i-ri-external-link-line size-3" aria-hidden="true" />
            </a>
          </>
        }
      >
        <p>{t(($) => $['educationDiscountPaused.description'], { ns: 'education' })}</p>
        <p className="mt-4">{t(($) => $['educationDiscountPaused.thanks'], { ns: 'education' })}</p>
        <p className="mt-4 system-xs-regular">
          {t(($) => $['educationDiscountPaused.publishedAt'], { ns: 'education' })}
        </p>
      </EducationStatusCard>
    </>
  )
}
