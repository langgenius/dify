'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiBook2Line,
  RiBox3Line,
  RiFileEditLine,
  RiGroup3Line,
  RiGroupLine,
  RiSquareLine,
} from '@remixicon/react'
import { Plan, SelfHostedPlan } from '../type'
import VectorSpaceInfo from '../usage-info/vector-space-info'
import AppsInfo from '../usage-info/apps-info'
import UpgradeBtn from '../upgrade-btn'
import { useProviderContext } from '@/context/provider-context'
import UsageInfo from '@/app/components/billing/usage-info'

type Props = {
  loc: string
}

const PlanComp: FC<Props> = ({
  loc,
}) => {
  const { t } = useTranslation()
  const { plan } = useProviderContext()
  const {
    type,
  } = plan

  const {
    usage,
    total,
  } = plan

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
    </div>
  )
}
export default React.memo(PlanComp)
