import type { CloudPlan } from '@dify/contracts/api/console/features/types.gen'
import type { PlanInfo } from '@/app/components/billing/type'

export const contactSalesUrl = 'https://vikgc6bnu1s.typeform.com/dify-business'
export const SELF_HOSTED_PLAN_URLS = {
  community: 'https://github.com/langgenius/dify',
  premium: 'https://aws.amazon.com/marketplace/pp/prodview-t22mebxzwjhu6',
  enterprise: contactSalesUrl,
} as const

export type SelfHostedPlan = keyof typeof SELF_HOSTED_PLAN_URLS

export const ALL_PLANS = {
  sandbox: {
    level: 1,
    price: 0,
    messageRequest: { count: 200, perMonth: false },
    teamMembers: 1,
    buildApps: 5,
    documents: 50,
    vectorSpace: '50MB',
    documentsRequestQuota: 10,
    documentProcessingPriority: 'standard',
    triggerEvents: { count: 3000, perMonth: false },
    startNodes: 2,
    workflowExecution: 'standard',
    annotatedResponse: 10,
    logHistory: 30,
    apiRateLimit: 5000,
  },
  professional: {
    level: 2,
    price: 59,
    messageRequest: { count: 5000, perMonth: true },
    teamMembers: 3,
    buildApps: 50,
    documents: 500,
    vectorSpace: '5GB',
    documentsRequestQuota: 100,
    documentProcessingPriority: 'priority',
    triggerEvents: { count: 20000, perMonth: true },
    startNodes: 'unlimited',
    workflowExecution: 'faster',
    annotatedResponse: 2000,
    logHistory: 'unlimited',
    apiRateLimit: 'unlimited',
  },
  team: {
    level: 3,
    price: 159,
    messageRequest: { count: 10000, perMonth: true },
    teamMembers: 50,
    buildApps: 200,
    documents: 1000,
    vectorSpace: '20GB',
    documentsRequestQuota: 1000,
    documentProcessingPriority: 'top-priority',
    triggerEvents: 'unlimited',
    startNodes: 'unlimited',
    workflowExecution: 'priority',
    annotatedResponse: 5000,
    logHistory: 'unlimited',
    apiRateLimit: 'unlimited',
  },
} satisfies Record<CloudPlan, PlanInfo>
