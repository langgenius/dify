'use client'

import type { EducationStatusResponse } from '@dify/contracts/api/console/account/types.gen'
import type { GetFeaturesResponse } from '@dify/contracts/api/console/features/types.gen'
import type { ReactNode } from 'react'
import { Button, buttonVariants } from '@langgenius/dify-ui/button'
import { useMutation, useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import { useDocLink } from '@/context/i18n'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import Link from '@/next/link'
import { redirect, useRouter } from '@/next/navigation'
import { consoleClient, consoleQuery } from '@/service/client'
import { EducationStatusCard } from '../status-card'
import UserInfo from '../user-info'

class EducationVerificationRejectedError extends Error {}

type EducationVerificationRequest = () => Promise<{ token?: string | null }>

const selectEducationStatus = ({ allow_refresh, is_student }: EducationStatusResponse) => ({
  allowRefresh: allow_refresh ?? false,
  isEducationAccount: is_student ?? false,
})

const selectEducationPlanEnabled = ({ education }: GetFeaturesResponse) => education.enabled

const requestEducationVerification: EducationVerificationRequest = () =>
  consoleClient.account.education.verify.get({}, { context: { silent: true } })

async function requestEducationVerificationToken(
  requestVerification: EducationVerificationRequest,
) {
  const response = await requestVerification()
  if (!response.token) throw new EducationVerificationRejectedError()

  return response.token
}

export default function EducationVerifyPage() {
  return <EducationVerifyFlow />
}

export function EducationVerifyFlow({
  requestVerification = requestEducationVerification,
}: {
  requestVerification?: EducationVerificationRequest
}) {
  const { t } = useTranslation()
  const router = useRouter()
  const { data: userEmail } = useSuspenseQuery({
    ...userProfileQueryOptions(),
    select: (data) => data.profile.email,
  })
  const docLink = useDocLink()
  const verificationStartedRef = useRef(false)
  const featuresQuery = useQuery(
    consoleQuery.features.get.queryOptions({ select: selectEducationPlanEnabled }),
  )
  const enableEducationPlan = featuresQuery.data === true
  const educationStatusQuery = useQuery(
    consoleQuery.account.education.get.queryOptions({
      enabled: featuresQuery.isSuccess && enableEducationPlan,
      select: selectEducationStatus,
    }),
  )
  const {
    error: verificationError,
    isError: isVerificationError,
    mutate: verifyEducation,
    reset: resetVerification,
  } = useMutation({
    mutationKey: ['education', 'verification-token'],
    mutationFn: () => requestEducationVerificationToken(requestVerification),
  })

  const startVerification = useCallback(() => {
    if (verificationStartedRef.current) return

    verificationStartedRef.current = true
    verifyEducation(undefined, {
      onSuccess: (token) => {
        router.replace(`/education/apply?token=${encodeURIComponent(token)}`)
      },
    })
  }, [router, verifyEducation])

  const educationStatus = educationStatusQuery.data
  const isAlreadyVerified =
    educationStatus?.isEducationAccount === true && !educationStatus.allowRefresh
  const canVerify =
    educationStatusQuery.isSuccess &&
    educationStatus !== undefined &&
    (!educationStatus.isEducationAccount || educationStatus.allowRefresh)

  useEffect(() => {
    if (canVerify) startVerification()
  }, [canVerify, startVerification])

  if (featuresQuery.isPending) return <EducationVerifyLoading />

  if (!enableEducationPlan) return redirect('/')

  if (educationStatusQuery.isPending) return <EducationVerifyLoading />

  if (educationStatusQuery.isError)
    return (
      <EducationVerifyError
        onRetry={() => {
          void educationStatusQuery.refetch()
        }}
      />
    )

  if (isAlreadyVerified) return <EducationVerifiedContent />

  if (verificationError instanceof EducationVerificationRejectedError) {
    return (
      <EducationVerifyContent>
        <EducationStatusCard
          icon={
            <span
              className="i-ri-close-circle-fill size-6 text-text-destructive"
              aria-hidden="true"
            />
          }
          title={t(($) => $.rejectTitle, { ns: 'education' })}
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
          <p>{t(($) => $.rejectContent, { ns: 'education' })}</p>
          <div className="mt-4">
            <div className="system-sm-semibold text-text-secondary">
              {t(($) => $.emailLabel, { ns: 'education' })}
            </div>
            <div className="mt-1 rounded-lg bg-components-input-bg-disabled px-3 py-2 system-sm-regular text-components-input-text-filled-disabled">
              {userEmail}
            </div>
          </div>
        </EducationStatusCard>
      </EducationVerifyContent>
    )
  }

  if (isVerificationError)
    return (
      <EducationVerifyError
        onRetry={() => {
          verificationStartedRef.current = false
          resetVerification()
          startVerification()
        }}
      />
    )

  return <EducationVerifyLoading />
}

function EducationVerifyContent({ children }: { children: ReactNode }) {
  return (
    <>
      <div className="mb-7">
        <UserInfo />
      </div>
      {children}
    </>
  )
}

function EducationVerifyLoading() {
  return (
    <EducationStatusCard
      icon={<Loading />}
      title={<span className="block h-5 w-40 animate-pulse rounded bg-background-section-burn" />}
    >
      <span className="block h-4 w-full max-w-100 animate-pulse rounded bg-background-section-burn" />
    </EducationStatusCard>
  )
}

function EducationVerifiedContent() {
  const { t } = useTranslation()

  return (
    <EducationVerifyContent>
      <EducationStatusCard
        icon={
          <span className="i-ri-checkbox-circle-fill size-6 text-text-success" aria-hidden="true" />
        }
        title={t(($) => $['applied.step1.description'], { ns: 'education' })}
        actions={
          <>
            <Link className={buttonVariants({ variant: 'primary' })} href="/?settings=billing">
              {t(($) => $['settings.billing'], { ns: 'common' })}
            </Link>
            <Link className={buttonVariants({ variant: 'ghost-accent' })} href="/">
              <span className="i-ri-arrow-left-line size-4" aria-hidden="true" />
              {t(($) => $['applied.noPaymentPermission.returnHome'], { ns: 'education' })}
            </Link>
          </>
        }
      />
    </EducationVerifyContent>
  )
}

function EducationVerifyError({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation()

  return (
    <EducationVerifyContent>
      <EducationStatusCard
        icon={
          <span
            className="i-ri-error-warning-fill size-6 text-text-warning-secondary"
            aria-hidden="true"
          />
        }
        title={t(($) => $['errorBoundary.title'], { ns: 'common' })}
        actions={
          <>
            <Button variant="primary" onClick={onRetry}>
              {t(($) => $['errorBoundary.tryAgain'], { ns: 'common' })}
            </Button>
            <Link className={buttonVariants({ variant: 'ghost-accent' })} href="/">
              <span className="i-ri-arrow-left-line size-4" aria-hidden="true" />
              {t(($) => $['applied.noPaymentPermission.returnHome'], { ns: 'education' })}
            </Link>
          </>
        }
      >
        {t(($) => $['errorBoundary.message'], { ns: 'common' })}
      </EducationStatusCard>
    </EducationVerifyContent>
  )
}
