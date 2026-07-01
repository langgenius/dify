'use client'

import dynamic from '@/next/dynamic'

const InSiteMessageNotification = dynamic(() => import('@/app/components/app/in-site-message/notification'), { ssr: false })
const PartnerStack = dynamic(() => import('@/app/components/billing/partner-stack'), { ssr: false })
const ReadmePanel = dynamic(() => import('@/app/components/plugins/readme-panel'), { ssr: false })
const WorkflowGeneratorMount = dynamic(() => import('@/app/components/workflow/workflow-generator/mount'), { ssr: false })
const GotoAnything = dynamic(() => import('@/app/components/goto-anything').then(mod => mod.GotoAnything), { ssr: false })

export function CommonLayoutGlobalMounts() {
  return (
    <>
      <InSiteMessageNotification />
      <PartnerStack />
      <ReadmePanel />
      <GotoAnything />
      <WorkflowGeneratorMount />
    </>
  )
}
