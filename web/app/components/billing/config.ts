import type { BasicPlan, PlanInfo } from '@/app/components/billing/type'
import { Plan, Priority } from '@/app/components/billing/type'

const supportModelProviders = 'OpenAI/Anthropic/Llama2/Azure OpenAI/Hugging Face/Replicate'

export const NUM_INFINITE = -1
export const contractSales = 'contractSales'
export const unAvailable = 'unAvailable'

export const contactSalesUrl = 'https://vikgc6bnu1s.typeform.com/dify-business'
export const getStartedWithCommunityUrl = 'https://github.com/langgenius/dify'
export const getWithPremiumUrl = 'https://aws.amazon.com/marketplace/pp/prodview-t22mebxzwjhu6'

export const ALL_PLANS: Record<BasicPlan, PlanInfo> = {
  sandbox: {
    level: 1,
    price: 0,
    modelProviders: supportModelProviders,
    teamWorkspace: 1,
    teamMembers: 1,
    buildApps: 5,
    documents: 50,
    vectorSpace: '50MB',
    documentsUploadQuota: 0,
    documentsRequestQuota: 10,
    apiRateLimit: 5000,
    documentProcessingPriority: Priority.standard,
    messageRequest: 200,
    triggerEvents: 3000,
    annotatedResponse: 10,
    logHistory: 30,
  },
  professional: {
    level: 2,
    price: 59,
    modelProviders: supportModelProviders,
    teamWorkspace: 1,
    teamMembers: 3,
    buildApps: 50,
    documents: 500,
    vectorSpace: '5GB',
    documentsUploadQuota: 0,
    documentsRequestQuota: 100,
    apiRateLimit: NUM_INFINITE,
    documentProcessingPriority: Priority.priority,
    messageRequest: 5000,
    triggerEvents: 20000,
    annotatedResponse: 2000,
    logHistory: NUM_INFINITE,
  },
  team: {
    level: 3,
    price: 159,
    modelProviders: supportModelProviders,
    teamWorkspace: 1,
    teamMembers: 50,
    buildApps: 200,
    documents: 1000,
    vectorSpace: '20GB',
    documentsUploadQuota: 0,
    documentsRequestQuota: 1000,
    apiRateLimit: NUM_INFINITE,
    documentProcessingPriority: Priority.topPriority,
    messageRequest: 10000,
    triggerEvents: NUM_INFINITE,
    annotatedResponse: 5000,
    logHistory: NUM_INFINITE,
  },
}

export const defaultPlan = {
  type: Plan.sandbox as BasicPlan,
  usage: {
    documents: 50,
    vectorSpace: 1,
    buildApps: 1,
    teamMembers: 1,
    annotatedResponse: 1,
    documentsUploadQuota: 0,
    apiRateLimit: 0,
    triggerEvents: 0,
  },
  total: {
    documents: 50,
    vectorSpace: 10,
    buildApps: 10,
    teamMembers: 1,
    annotatedResponse: 10,
    documentsUploadQuota: 0,
    apiRateLimit: ALL_PLANS.sandbox.apiRateLimit,
    triggerEvents: ALL_PLANS.sandbox.triggerEvents,
  },
  reset: {
    apiRateLimit: null,
    triggerEvents: null,
  },
}
