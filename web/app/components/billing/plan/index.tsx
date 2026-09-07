'use client'
import type { EducationStatusResponse } from '@dify/contracts/api/console/account/types.gen'
import type { FC } from 'react'
import { Button, buttonVariants } from '@langgenius/dify-ui/button'
import { RiApps2Line, RiBook2Line, RiFileEditLine, RiGroupLine } from '@remixicon/react'
import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { ApiAggregate, TriggerAll } from '@/app/components/base/icons/src/vender/workflow'
import UsageInfo from '@/app/components/billing/usage-info'
import { isCurrentWorkspaceManagerAtom } from '@/context/workspace-state'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import Link from '@/next/link'
import { consoleQuery } from '@/service/client'
import { getDaysUntilEndOfMonth } from '@/utils/time'
import Loading from '../../base/icons/src/public/thought/Loading'
import { NUM_INFINITE } from '../config'
import { useEducationDiscount } from '../hooks/use-education-discount'
import UpgradeBtn from '../upgrade-btn'
import VectorSpaceInfo from '../usage-info/vector-space-info'
import { getResetInDaysFromDate, parseLimit } from '../utils'
import { Professional, Sandbox, Team } from './assets'

type Props = Readonly<{
  loc: string
}>

const selectEducationPlanStatus = ({ allow_refresh, is_student }: EducationStatusResponse) => ({
  isAboutToExpire: allow_refresh ?? false,
  isEducationAccount: is_student ?? false,
})

const PlanComp: FC<Props> = ({ loc }) => {
  const { t } = useTranslation()
  const { data: deploymentEdition } = useSuspenseQuery({
    ...systemFeaturesQueryOptions(),
    select: ({ deployment_edition }) => deployment_edition,
  })
  const isCloudEdition = deploymentEdition === 'CLOUD'
  const isCurrentWorkspaceManager = useAtomValue(isCurrentWorkspaceManagerAtom)
  const { data: features } = useSuspenseQuery(consoleQuery.features.get.queryOptions())
  const enableEducationPlan = features.education.enabled
  const { data: educationStatus } = useQuery(
    consoleQuery.account.education.get.queryOptions({
      enabled: enableEducationPlan,
      select: selectEducationPlanStatus,
    }),
  )
  const { isAboutToExpire = false, isEducationAccount = false } = educationStatus ?? {}
  const type = features.billing.subscription.plan
  const triggerEventsLimit = features.trigger_event.limit
  const apiRateLimit = features.api_rate_limit.limit
  const apiRateLimitReset = getResetInDaysFromDate(features.api_rate_limit.reset_date)
  const triggerEventsResetInDays =
    type === 'professional' && triggerEventsLimit !== NUM_INFINITE
      ? (getResetInDaysFromDate(features.trigger_event.reset_date) ?? undefined)
      : undefined
  const apiRateLimitResetInDays = (() => {
    if (apiRateLimit === NUM_INFINITE) return undefined
    if (typeof apiRateLimitReset === 'number') return apiRateLimitReset
    if (type === 'sandbox') return getDaysUntilEndOfMonth()
    return undefined
  })()

  const { handleEducationDiscount, isEducationDiscountLoading } = useEducationDiscount()
  return (
    <div className="relative rounded-2xl border-[0.5px] border-effects-highlight-lightmode-off bg-background-section-burn">
      <div className="p-6 pb-2">
        {type === 'sandbox' && <Sandbox />}
        {type === 'professional' && <Professional />}
        {type === 'team' && <Team />}
        <div className="mt-1 flex items-center">
          <div className="grow">
            <div className="mb-1 flex items-center gap-1">
              <div className="system-md-semibold-uppercase text-text-primary">
                {t(($) => $[`plans.${type}.name`], { ns: 'billing' })}
              </div>
            </div>
            <div className="system-xs-regular text-util-colors-gray-gray-600">
              {t(($) => $[`plans.${type}.for`], { ns: 'billing' })}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {isCloudEdition && enableEducationPlan && (!isEducationAccount || isAboutToExpire) && (
              <Link className={buttonVariants({ variant: 'ghost' })} href="/education/verify">
                <span className="i-ri-graduation-cap-line size-4" aria-hidden="true" />
                {t(($) => $.toVerified, { ns: 'education' })}
              </Link>
            )}
            {isCloudEdition &&
              enableEducationPlan &&
              isEducationAccount &&
              type === 'sandbox' &&
              isCurrentWorkspaceManager && (
                <Button
                  variant="ghost"
                  onClick={handleEducationDiscount}
                  disabled={isEducationDiscountLoading}
                >
                  <span className="i-ri-graduation-cap-line size-4" aria-hidden="true" />
                  {t(($) => $.useEducationDiscount, { ns: 'education' })}
                  {isEducationDiscountLoading && <Loading className="animate-spin-slow" />}
                </Button>
              )}
            {isCloudEdition && (
              <UpgradeBtn className="shrink-0" isPlain={type === 'team'} isShort loc={loc} />
            )}
          </div>
        </div>
      </div>
      {/* Plan detail */}
      <div className="grid grid-cols-3 content-start gap-1 p-2">
        <UsageInfo
          Icon={RiApps2Line}
          name={t(($) => $['usagePage.buildApps'], { ns: 'billing' })}
          usage={features.apps.size}
          total={parseLimit(features.apps.limit)}
        />
        <UsageInfo
          Icon={RiGroupLine}
          name={t(($) => $['usagePage.teamMembers'], { ns: 'billing' })}
          usage={features.members.size}
          total={parseLimit(features.members.limit)}
        />
        <UsageInfo
          Icon={RiBook2Line}
          name={t(($) => $['usagePage.documentsUploadQuota'], { ns: 'billing' })}
          usage={features.documents_upload_quota.size}
          total={parseLimit(features.documents_upload_quota.limit)}
        />
        <VectorSpaceInfo />
        <UsageInfo
          Icon={RiFileEditLine}
          name={t(($) => $['usagePage.annotationQuota'], { ns: 'billing' })}
          usage={features.annotation_quota_limit.size}
          total={parseLimit(features.annotation_quota_limit.limit)}
        />
        <UsageInfo
          Icon={TriggerAll}
          name={t(($) => $['usagePage.triggerEvents'], { ns: 'billing' })}
          usage={features.trigger_event.usage}
          total={triggerEventsLimit}
          tooltip={t(($) => $['plansCommon.triggerEvents.tooltip'], { ns: 'billing' }) as string}
          resetInDays={triggerEventsResetInDays}
        />
        <UsageInfo
          Icon={ApiAggregate}
          name={t(($) => $['plansCommon.apiRateLimit'], { ns: 'billing' })}
          usage={features.api_rate_limit.usage}
          total={apiRateLimit}
          tooltip={
            apiRateLimit === NUM_INFINITE
              ? undefined
              : (t(($) => $['plansCommon.apiRateLimitTooltip'], { ns: 'billing' }) as string)
          }
          resetInDays={apiRateLimitResetInDays}
        />
      </div>
    </div>
  )
}
export default React.memo(PlanComp)
