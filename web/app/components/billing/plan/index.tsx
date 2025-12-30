'use client'
import type { FC } from 'react'
import {
  RiBook2Line,
  RiFileEditLine,
  RiGraduationCapLine,
  RiGroupLine,
} from '@remixicon/react'
import { useUnmountedRef } from 'ahooks'
import { usePathname, useRouter } from 'next/navigation'
import * as React from 'react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import { ApiAggregate, TriggerAll } from '@/app/components/base/icons/src/vender/workflow'
import UsageInfo from '@/app/components/billing/usage-info'
import { EDUCATION_VERIFYING_LOCALSTORAGE_ITEM } from '@/app/education-apply/constants'
import VerifyStateModal from '@/app/education-apply/verify-state-modal'
import { useAppContext } from '@/context/app-context'
import { useModalContextSelector } from '@/context/modal-context'
import { useProviderContext } from '@/context/provider-context'
import { useEducationVerify } from '@/service/use-education'
import { getDaysUntilEndOfMonth } from '@/utils/time'
import { Loading } from '../../base/icons/src/public/thought'
import { NUM_INFINITE } from '../config'
import { Plan, SelfHostedPlan } from '../type'
import UpgradeBtn from '../upgrade-btn'
import AppsInfo from '../usage-info/apps-info'
import VectorSpaceInfo from '../usage-info/vector-space-info'
import { Enterprise, Professional, Sandbox, Team } from './assets'

type Props = {
  loc: string
}

const PlanComp: FC<Props> = ({
  loc,
}) => {
  const { t } = useTranslation()
  const router = useRouter()
  const path = usePathname()
  const { userProfile } = useAppContext()
  const { plan, enableEducationPlan, allowRefreshEducationVerify, isEducationAccount } = useProviderContext()
  const isAboutToExpire = allowRefreshEducationVerify
  const {
    type,
  } = plan

  const {
    usage,
    total,
    reset,
  } = plan
  const triggerEventsResetInDays = type === Plan.professional && total.triggerEvents !== NUM_INFINITE
    ? reset.triggerEvents ?? undefined
    : undefined
  const apiRateLimitResetInDays = (() => {
    if (total.apiRateLimit === NUM_INFINITE)
      return undefined
    if (typeof reset.apiRateLimit === 'number')
      return reset.apiRateLimit
    if (type === Plan.sandbox)
      return getDaysUntilEndOfMonth()
    return undefined
  })()

  const [showModal, setShowModal] = React.useState(false)
  const { mutateAsync, isPending } = useEducationVerify()
  const setShowAccountSettingModal = useModalContextSelector(s => s.setShowAccountSettingModal)
  const unmountedRef = useUnmountedRef()
  const handleVerify = () => {
    if (isPending)
      return
    mutateAsync().then((res) => {
      localStorage.removeItem(EDUCATION_VERIFYING_LOCALSTORAGE_ITEM)
      if (unmountedRef.current)
        return
      router.push(`/education-apply?token=${res.token}`)
    }).catch(() => {
      setShowModal(true)
    })
  }
  useEffect(() => {
    // setShowAccountSettingModal would prevent navigation
    if (path.startsWith('/education-apply'))
      setShowAccountSettingModal(null)
  }, [path, setShowAccountSettingModal])
  return (
    <div className="relative rounded-2xl border-[0.5px] border-effects-highlight-lightmode-off bg-background-section-burn">
      <div className="p-6 pb-2">
        {plan.type === Plan.sandbox && (
          <Sandbox />
        )}
        {plan.type === Plan.professional && (
          <Professional />
        )}
        {plan.type === Plan.team && (
          <Team />
        )}
        {(plan.type as any) === SelfHostedPlan.enterprise && (
          <Enterprise />
        )}
        <div className="mt-1 flex items-center">
          <div className="grow">
            <div className="mb-1 flex items-center gap-1">
              <div className="system-md-semibold-uppercase text-text-primary">{t(`plans.${type}.name`, { ns: 'billing' })}</div>
            </div>
            <div className="system-xs-regular text-util-colors-gray-gray-600">{t(`plans.${type}.for`, { ns: 'billing' })}</div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {enableEducationPlan && (!isEducationAccount || isAboutToExpire) && (
              <Button variant="ghost" onClick={handleVerify} disabled={isPending}>
                <RiGraduationCapLine className="mr-1 h-4 w-4" />
                {t('toVerified', { ns: 'education' })}
                {isPending && <Loading className="ml-1 animate-spin-slow" />}
              </Button>
            )}
            {(plan.type as any) !== SelfHostedPlan.enterprise && (
              <UpgradeBtn
                className="shrink-0"
                isPlain={type === Plan.team}
                isShort
                loc={loc}
              />
            )}
          </div>
        </div>
      </div>
      {/* Plan detail */}
      <div className="grid grid-cols-3 content-start gap-1 p-2">
        <AppsInfo />
        <UsageInfo
          Icon={RiGroupLine}
          name={t('usagePage.teamMembers', { ns: 'billing' })}
          usage={usage.teamMembers}
          total={total.teamMembers}
        />
        <UsageInfo
          Icon={RiBook2Line}
          name={t('usagePage.documentsUploadQuota', { ns: 'billing' })}
          usage={usage.documentsUploadQuota}
          total={total.documentsUploadQuota}
        />
        <VectorSpaceInfo />
        <UsageInfo
          Icon={RiFileEditLine}
          name={t('usagePage.annotationQuota', { ns: 'billing' })}
          usage={usage.annotatedResponse}
          total={total.annotatedResponse}
        />
        <UsageInfo
          Icon={TriggerAll}
          name={t('usagePage.triggerEvents', { ns: 'billing' })}
          usage={usage.triggerEvents}
          total={total.triggerEvents}
          tooltip={t('plansCommon.triggerEvents.tooltip', { ns: 'billing' }) as string}
          resetInDays={triggerEventsResetInDays}
        />
        <UsageInfo
          Icon={ApiAggregate}
          name={t('plansCommon.apiRateLimit', { ns: 'billing' })}
          usage={usage.apiRateLimit}
          total={total.apiRateLimit}
          tooltip={total.apiRateLimit === NUM_INFINITE ? undefined : t('plansCommon.apiRateLimitTooltip', { ns: 'billing' }) as string}
          resetInDays={apiRateLimitResetInDays}
        />

      </div>
      <VerifyStateModal
        showLink
        email={userProfile.email}
        isShow={showModal}
        title={t('rejectTitle', { ns: 'education' })}
        content={t('rejectContent', { ns: 'education' })}
        onConfirm={() => setShowModal(false)}
        onCancel={() => setShowModal(false)}
      />
    </div>
  )
}
export default React.memo(PlanComp)
