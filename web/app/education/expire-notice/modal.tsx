'use client'
import { Button, buttonVariants } from '@langgenius/dify-ui/button'
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@langgenius/dify-ui/dialog'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { useSuspenseQuery } from '@tanstack/react-query'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useDocLink } from '@/context/i18n'
import { useModalContextSelector } from '@/context/modal-context'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import useTimestamp from '@/hooks/use-timestamp'
import Link from '@/next/link'

type ExpireNoticeModalPayloadProps = {
  expireAt: number
  expired: boolean
}
type Props = {
  onClose: () => void
} & ExpireNoticeModalPayloadProps

const i18nPrefix = 'notice'

const ExpireNoticeModal: React.FC<Props> = ({ expireAt, expired, onClose }) => {
  const { t } = useTranslation()
  const { data: deploymentEdition } = useSuspenseQuery({
    ...systemFeaturesQueryOptions(),
    select: ({ deployment_edition }) => deployment_edition,
  })
  const docLink = useDocLink()
  const eduDocLink = docLink('/use-dify/workspace/subscription-management#dify-for-education')
  const { formatTime } = useTimestamp()
  const setShowPricingModal = useModalContextSelector((s) => s.setShowPricingModal)

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="w-full max-w-150 overflow-hidden! border-none text-left align-middle">
        <DialogClose
          render={
            <IconButton
              aria-label={t(($) => $['operation.close'], { ns: 'common' })}
              size="lg"
              className="absolute inset-e-6 top-6"
            >
              <span aria-hidden className="i-ri-close-line size-4" />
            </IconButton>
          }
        />
        <DialogTitle className="title-2xl-semi-bold text-text-primary">
          {expired
            ? t(($) => $[`${i18nPrefix}.expired.title`], { ns: 'education' })
            : t(($) => $[`${i18nPrefix}.isAboutToExpire.title`], {
                ns: 'education',
                date: formatTime(
                  expireAt,
                  t(($) => $[`${i18nPrefix}.dateFormat`], { ns: 'education' }) as string,
                ),
                interpolation: { escapeValue: false },
              })}
        </DialogTitle>

        <div className="mt-5 space-y-5 body-md-regular text-text-secondary">
          <div>
            {expired ? (
              <>
                <div>{t(($) => $[`${i18nPrefix}.expired.summary.line1`], { ns: 'education' })}</div>
                <div>{t(($) => $[`${i18nPrefix}.expired.summary.line2`], { ns: 'education' })}</div>
              </>
            ) : (
              t(($) => $[`${i18nPrefix}.isAboutToExpire.summary`], { ns: 'education' })
            )}
          </div>
          <div>
            <strong className="block title-md-semi-bold">
              {t(($) => $[`${i18nPrefix}.stillInEducation.title`], { ns: 'education' })}
            </strong>
            {t(
              ($) => $[`${i18nPrefix}.stillInEducation.${expired ? 'expired' : 'isAboutToExpire'}`],
              { ns: 'education' },
            )}
          </div>
          <div>
            <strong className="block title-md-semi-bold">
              {t(($) => $[`${i18nPrefix}.alreadyGraduated.title`], { ns: 'education' })}
            </strong>
            {t(
              ($) => $[`${i18nPrefix}.alreadyGraduated.${expired ? 'expired' : 'isAboutToExpire'}`],
              { ns: 'education' },
            )}
          </div>
        </div>
        <div className="mt-7 flex items-center justify-between space-x-2">
          <Link
            className="flex items-center space-x-1 system-xs-regular text-text-accent"
            href={eduDocLink}
            target="_blank"
            rel="noopener noreferrer"
          >
            <span>{t(($) => $.learn, { ns: 'education' })}</span>
            <span className="i-ri-external-link-line size-3" aria-hidden="true" />
          </Link>
          <div className="flex space-x-2">
            {expired && deploymentEdition === 'CLOUD' ? (
              <Button
                onClick={() => {
                  onClose()
                  setShowPricingModal()
                }}
                className="flex items-center"
              >
                <span
                  className="i-custom-public-common-sparkles-soft-accent size-4"
                  aria-hidden="true"
                />
                <span className="text-components-button-secondary-accent-text">
                  {t(($) => $[`${i18nPrefix}.action.upgrade`], { ns: 'education' })}
                </span>
              </Button>
            ) : (
              <Button onClick={onClose}>
                {t(($) => $[`${i18nPrefix}.action.dismiss`], { ns: 'education' })}
              </Button>
            )}
            <Link
              className={buttonVariants({ variant: 'primary' })}
              href="/education/verify"
              onClick={onClose}
            >
              {t(($) => $[`${i18nPrefix}.action.reVerify`], { ns: 'education' })}
            </Link>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default React.memo(ExpireNoticeModal)
