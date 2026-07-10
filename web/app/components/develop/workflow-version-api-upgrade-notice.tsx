'use client'

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PlanUpgradeModal } from '@/app/components/billing/plan-upgrade-modal'
import { Plan } from '@/app/components/billing/type'
import UpgradeBtn from '@/app/components/billing/upgrade-btn'
import { useProviderContext } from '@/context/provider-context'

const WorkflowVersionApiUpgradeNotice = () => {
  const { t } = useTranslation('billing')
  const { plan, enableBilling, isFetchedPlan } = useProviderContext()
  const [isPlanUpgradeModalOpen, setIsPlanUpgradeModalOpen] = useState(false)

  if (!isFetchedPlan || !enableBilling || plan.type !== Plan.sandbox)
    return null

  const title = t($ => $['upgrade.workflowVersionRun.title'])
  const description = t($ => $['upgrade.workflowVersionRun.description'])

  return (
    <>
      <span className="inline-flex">
        <UpgradeBtn
          isShort
          size="custom"
          loc="workflow-version-api-docs"
          className="h-5! rounded-md! px-1!"
          onClick={() => setIsPlanUpgradeModalOpen(true)}
        />
      </span>
      {isPlanUpgradeModalOpen && (
        <PlanUpgradeModal
          show
          onClose={() => setIsPlanUpgradeModalOpen(false)}
          title={title}
          description={description}
        />
      )}
    </>
  )
}

export default WorkflowVersionApiUpgradeNotice
