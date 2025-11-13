'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useRouter } from 'next/navigation'
import {
  RiBook2Line,
  RiFileEditLine,
  RiGraduationCapLine,
  RiGroupLine,
} from '@remixicon/react'
import { Plan, SelfHostedPlan } from '../type'
import { NUM_INFINITE } from '../config'
import VectorSpaceInfo from '../usage-info/vector-space-info'
import AppsInfo from '../usage-info/apps-info'
import UpgradeBtn from '../upgrade-btn'
import { ApiAggregate, TriggerAll } from '@/app/components/base/icons/src/vender/workflow'
import { useProviderContext } from '@/context/provider-context'
import { useAppContext } from '@/context/app-context'
import Button from '@/app/components/base/button'
import UsageInfo from '@/app/components/billing/usage-info'
import VerifyStateModal from '@/app/education-apply/verify-state-modal'
import { EDUCATION_VERIFYING_LOCALSTORAGE_ITEM } from '@/app/education-apply/constants'
import { useEducationVerify } from '@/service/use-education'
import { useModalContextSelector } from '@/context/modal-context'
import { Enterprise, Professional, Sandbox, Team } from './assets'

type Props = {
  loc: string
}

const PlanComp: FC<Props> = ({
  loc,
}) => {
  const { t } = useTranslation()
  const router = useRouter()
  const { userProfile } = useAppContext()
  const { plan, enableEducationPlan, allowRefreshEducationVerify, isEducationAccount } = useProviderContext()
  const isAboutToExpire = allowRefreshEducationVerify
  const {
    type,
  } = plan

  const {
    usage,
    total,
  } = plan

  const [showModal, setShowModal] = React.useState(false)
  const { mutateAsync } = useEducationVerify()
  const setShowAccountSettingModal = useModalContextSelector(s => s.setShowAccountSettingModal)
  const handleVerify = () => {
    mutateAsync().then((res) => {
      localStorage.removeItem(EDUCATION_VERIFYING_LOCALSTORAGE_ITEM)
      router.push(`/education-apply?token=${res.token}`)
      setShowAccountSettingModal(null)
    }).catch(() => {
      setShowModal(true)
    })
  }
  return (
    <div className='relative rounded-2xl border-[0.5px] border-effects-highlight-lightmode-off bg-background-section-burn'>
      <div className='p-6 pb-2'>
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
        <div className='mt-1 flex items-center'>
          <div className='grow'>
            <div className='mb-1 flex items-center gap-1'>
              <div className='system-md-semibold-uppercase text-text-primary'>{t(`billing.plans.${type}.name`)}</div>
            </div>
            <div className='system-xs-regular text-util-colors-gray-gray-600'>{t(`billing.plans.${type}.for`)}</div>
          </div>
          <div className='flex shrink-0 items-center gap-1'>
            {enableEducationPlan && (!isEducationAccount || isAboutToExpire) && (
              <Button variant='ghost' onClick={handleVerify}>
                <RiGraduationCapLine className='mr-1 h-4 w-4' />
                {t('education.toVerified')}
              </Button>
            )}
            {(plan.type as any) !== SelfHostedPlan.enterprise && (
              <UpgradeBtn
                className='shrink-0'
                isPlain={type === Plan.team}
                isShort
                loc={loc}
              />
            )}
          </div>
        </div>
      </div>
      {/* Plan detail */}
      <div className='grid grid-cols-3 content-start gap-1 p-2'>
        <AppsInfo />
        <UsageInfo
          Icon={RiGroupLine}
          name={t('billing.usagePage.teamMembers')}
          usage={usage.teamMembers}
          total={total.teamMembers}
        />
        <UsageInfo
          Icon={RiBook2Line}
          name={t('billing.usagePage.documentsUploadQuota')}
          usage={usage.documentsUploadQuota}
          total={total.documentsUploadQuota}
        />
        <VectorSpaceInfo />
        <UsageInfo
          Icon={RiFileEditLine}
          name={t('billing.usagePage.annotationQuota')}
          usage={usage.annotatedResponse}
          total={total.annotatedResponse}
        />
        <UsageInfo
          Icon={TriggerAll}
          name={t('billing.usagePage.triggerEvents')}
          usage={usage.triggerEvents}
          total={total.triggerEvents}
          tooltip={t('billing.plansCommon.triggerEvents.tooltip') as string}
        />
        <UsageInfo
          Icon={ApiAggregate}
          name={t('billing.plansCommon.apiRateLimit')}
          usage={usage.apiRateLimit}
          total={total.apiRateLimit}
          tooltip={total.apiRateLimit === NUM_INFINITE ? undefined : t('billing.plansCommon.apiRateLimitTooltip') as string}
        />

      </div>
      <VerifyStateModal
        showLink
        email={userProfile.email}
        isShow={showModal}
        title={t('education.rejectTitle')}
        content={t('education.rejectContent')}
        onConfirm={() => setShowModal(false)}
        onCancel={() => setShowModal(false)}
      />
    </div>
  )
}
export default React.memo(PlanComp)
