'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useRouter } from 'next/navigation'
import {
  RiBook2Line,
  RiBox3Line,
  RiFileEditLine,
  RiGraduationCapLine,
  RiGroup3Line,
  RiGroupLine,
  RiSquareLine,
} from '@remixicon/react'
import { Plan, SelfHostedPlan } from '../type'
import VectorSpaceInfo from '../usage-info/vector-space-info'
import AppsInfo from '../usage-info/apps-info'
import UpgradeBtn from '../upgrade-btn'
import { useProviderContext } from '@/context/provider-context'
import { useAppContext } from '@/context/app-context'
import Button from '@/app/components/base/button'
import UsageInfo from '@/app/components/billing/usage-info'
import VerifyStateModal from '@/app/education-apply/verify-state-modal'
import { EDUCATION_VERIFYING_LOCALSTORAGE_ITEM } from '@/app/education-apply/constants'
import { useEducationVerify } from '@/service/use-education'
import { useModalContextSelector } from '@/context/modal-context'

type Props = {
  loc: string
}

const PlanComp: FC<Props> = ({
  loc,
}) => {
  const { t } = useTranslation()
  const router = useRouter()
  const { userProfile } = useAppContext()
  const { plan, enableEducationPlan, isEducationAccount } = useProviderContext()
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
    <div className='rounded-2xl border-[0.5px] border-effects-highlight-lightmode-off bg-background-section-burn'>
      <div className='p-6 pb-2'>
        {plan.type === Plan.sandbox && (
          <RiBox3Line className='h-7 w-7 text-text-primary'/>
        )}
        {plan.type === Plan.professional && (
          <RiSquareLine className='h-7 w-7 rotate-90 text-util-colors-blue-brand-blue-brand-600'/>
        )}
        {plan.type === Plan.team && (
          <RiGroup3Line className='h-7 w-7 text-util-colors-indigo-indigo-600'/>
        )}
        {(plan.type as any) === SelfHostedPlan.enterprise && (
          <RiGroup3Line className='h-7 w-7 text-util-colors-indigo-indigo-600'/>
        )}
        <div className='mt-1 flex items-center'>
          <div className='grow'>
            <div className='mb-1 flex items-center gap-1'>
              <div className='system-md-semibold-uppercase text-text-primary'>{t(`billing.plans.${type}.name`)}</div>
              <div className='system-2xs-medium-uppercase rounded-[5px] border border-divider-deep px-1 py-0.5 text-text-tertiary'>{t('billing.currentPlan')}</div>
            </div>
            <div className='system-xs-regular text-util-colors-gray-gray-600'>{t(`billing.plans.${type}.for`)}</div>
          </div>
          <div className='flex shrink-0 items-center gap-1'>
            {enableEducationPlan && !isEducationAccount && (
              <Button variant='ghost' onClick={handleVerify}>
                <RiGraduationCapLine className='mr-1 h-4 w-4'/>
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
