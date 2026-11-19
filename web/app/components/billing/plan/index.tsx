'use client'
import type { EducationStatusResponse } from '@dify/contracts/api/console/account/types.gen'
import type { FC } from 'react'
import { Button, buttonVariants } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import UsageInfo from '@/app/components/billing/usage-info'
import { isCurrentWorkspaceManagerAtom } from '@/context/workspace-state'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import Link from '@/next/link'
import { consoleQuery } from '@/service/console'
import { useEducationDiscount } from '../hooks/use-education-discount'
import { getAppRunsQuota, getCountQuota, getTriggerEventsQuota } from '../quota'
import UpgradeBtn from '../upgrade-btn'
import VectorSpaceInfo from '../usage-info/vector-space-info'
import { Professional, Sandbox, Team } from './assets'

type Props = Readonly<{
  loc: string
}>

const selectEducationPlanStatus = ({ allow_refresh, is_student }: EducationStatusResponse) => ({
  isAboutToExpire: allow_refresh,
  isEducationAccount: is_student,
})

const PlanComp: FC<Props> = ({ loc }) => {
  const { t } = useTranslation(['billing', 'education'])
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
  const appRunsQuota = getAppRunsQuota(features.api_rate_limit, type)

  const { handleEducationDiscount, isEducationDiscountLoading } = useEducationDiscount()
  return (
    <div className="@container/plan relative min-w-0 rounded-2xl border-[0.5px] border-effects-highlight-lightmode-off bg-background-section-burn">
      <div className="p-6 pb-2">
        {type === 'sandbox' && <Sandbox />}
        {type === 'professional' && <Professional />}
        {type === 'team' && <Team />}
        <div className="mt-1 flex flex-col items-start gap-y-3 @min-[28rem]/plan:flex-row @min-[28rem]/plan:flex-wrap @min-[28rem]/plan:items-center">
          <div className="max-w-full min-w-0 grow @min-[28rem]/plan:basis-52">
            <div className="mb-1 flex items-center gap-1">
              <h4 className="system-md-semibold-uppercase wrap-anywhere text-text-primary">
                {t(($) => $[`plans.${type}.name`], { ns: 'billing' })}
              </h4>
            </div>
            <div className="system-xs-regular text-util-colors-gray-gray-600">
              {t(($) => $[`plans.${type}.for`], { ns: 'billing' })}
            </div>
          </div>
          <div className="flex max-w-full shrink-0 flex-wrap items-center gap-1">
            {isCloudEdition && enableEducationPlan && (!isEducationAccount || isAboutToExpire) && (
              <Link
                className={cn(
                  buttonVariants({ variant: 'ghost' }),
                  'h-auto min-h-8 max-w-full wrap-anywhere whitespace-normal',
                )}
                href="/education/verify"
              >
                <span className="i-ri-graduation-cap-line size-4 shrink-0" aria-hidden="true" />
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
                  className="h-auto min-h-8 max-w-full wrap-anywhere whitespace-normal"
                  onClick={handleEducationDiscount}
                  disabled={isEducationDiscountLoading}
                >
                  <span className="i-ri-graduation-cap-line size-4 shrink-0" aria-hidden="true" />
                  {t(($) => $.useEducationDiscount, { ns: 'education' })}
                  {isEducationDiscountLoading && (
                    <span
                      aria-hidden
                      className="i-custom-public-thought-loading h-3 w-3 animate-spin-slow"
                    />
                  )}
                </Button>
              )}
            {isCloudEdition && (
              <UpgradeBtn
                className="max-w-full shrink-0"
                isPlain={type === 'team'}
                isShort
                loc={loc}
              />
            )}
          </div>
        </div>
      </div>
      {/* Plan detail */}
      <div className="grid grid-cols-1 content-start gap-1 p-2 @min-[28rem]/plan:grid-cols-2 @min-[42rem]/plan:grid-cols-3">
        <UsageInfo
          iconClassName="i-ri-apps-2-line"
          name={t(($) => $['usagePage.buildApps'], { ns: 'billing' })}
          quota={getCountQuota(features.apps)}
        />
        <UsageInfo
          iconClassName="i-ri-group-line"
          name={t(($) => $['usagePage.teamMembers'], { ns: 'billing' })}
          quota={getCountQuota(features.members)}
        />
        <UsageInfo
          iconClassName="i-ri-book-2-line"
          name={t(($) => $['usagePage.documentsUploadQuota'], { ns: 'billing' })}
          quota={getCountQuota(features.documents_upload_quota)}
        />
        <VectorSpaceInfo />
        <UsageInfo
          iconClassName="i-ri-file-edit-line"
          name={t(($) => $['usagePage.annotationQuota'], { ns: 'billing' })}
          quota={getCountQuota(features.annotation_quota_limit)}
        />
        <UsageInfo
          iconClassName={'i-custom-vender-workflow-trigger-all'}
          name={t(($) => $['usagePage.triggerEvents'], { ns: 'billing' })}
          quota={getTriggerEventsQuota(features.trigger_event, type)}
          tooltip={t(($) => $['plansCommon.triggerEvents.tooltip'], { ns: 'billing' }) as string}
        />
        <UsageInfo
          iconClassName={'i-custom-vender-workflow-api-aggregate'}
          name={t(($) => $['plansCommon.apiRateLimit'], { ns: 'billing' })}
          quota={appRunsQuota}
          tooltip={
            appRunsQuota.limit === 'unlimited'
              ? undefined
              : (t(($) => $['plansCommon.apiRateLimitTooltip'], { ns: 'billing' }) as string)
          }
        />
      </div>
    </div>
  )
}
export default React.memo(PlanComp)
