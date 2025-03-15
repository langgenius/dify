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
import VerifyStateModal from '@/app/education-apply/components/verify-state-modal'

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
  const handleVerify = () => {
    if (userProfile.email.endsWith('.edu'))
      router.push('/education-apply')
    else
      setShowModal(true)
  }
  return (
    <div className='bg-background-section-burn rounded-2xl border-[0.5px] border-effects-highlight-lightmode-off'>
      <div className='p-6 pb-2'>
        {plan.type === Plan.sandbox && (
          <RiBox3Line className='w-7 h-7 text-text-primary'/>
        )}
        {plan.type === Plan.professional && (
          <RiSquareLine className='w-7 h-7 rotate-90 text-util-colors-blue-brand-blue-brand-600'/>
        )}
        {plan.type === Plan.team && (
          <RiGroup3Line className='w-7 h-7 text-util-colors-indigo-indigo-600'/>
        )}
        {(plan.type as any) === SelfHostedPlan.enterprise && (
          <RiGroup3Line className='w-7 h-7 text-util-colors-indigo-indigo-600'/>
        )}
        <div className='mt-1 flex items-center'>
          <div className='grow'>
            <div className='mb-1 flex items-center gap-1'>
              <div className='text-text-primary system-md-semibold-uppercase'>{t(`billing.plans.${type}.name`)}</div>
              <div className='px-1 py-0.5 border border-divider-deep rounded-[5px] text-text-tertiary system-2xs-medium-uppercase'>{t('billing.currentPlan')}</div>
            </div>
            <div className='system-xs-regular text-util-colors-gray-gray-600'>{t(`billing.plans.${type}.for`)}</div>
          </div>
          <div className='shrink-0 flex items-center gap-1'>
            {enableEducationPlan && !isEducationAccount && (
              <Button variant='ghost' onClick={handleVerify}>
                <RiGraduationCapLine className='w-4 h-4 mr-1'/>
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
      <div className='p-2 grid content-start grid-cols-3 gap-1'>
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
        content={t('education.rejectContent2')}
        onConfirm={() => setShowModal(false)}
        onCancel={() => setShowModal(false)}
      />
    </div>
  )
}
export default React.memo(PlanComp)
