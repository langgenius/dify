import { Plan, type PlanInfo, Priority } from '@/app/components/billing/type'

const supportModelProviders = 'OpenAI/Anthropic/Llama2/Azure OpenAI/Hugging Face/Replicate'

export const NUM_INFINITE = 99999999
export const contractSales = 'contractSales'
export const unAvailable = 'unAvailable'

export const contactSalesUrl = 'mailto:business@dify.ai'

export const ALL_PLANS: Record<Plan, PlanInfo> = {
  sandbox: {
    level: 1,
    price: 0,
    modelProviders: supportModelProviders,
    teamWorkspace: 1,
    teamMembers: 1,
    buildApps: 5,
    documents: 50,
    vectorSpace: '50MB',
    documentsRequestQuota: 10,
    documentProcessingPriority: Priority.standard,
    messageRequest: 200,
    annotatedResponse: 10,
    logHistory: 15,
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
    documentsRequestQuota: 10,
    documentProcessingPriority: Priority.priority,
    messageRequest: 5000,
    annotatedResponse: 2000,
    logHistory: NUM_INFINITE,
  },
  team: {
    level: 3,
    price: 159,
    modelProviders: supportModelProviders,
    teamWorkspace: 1,
    teamMembers: 5,
    buildApps: 200,
    documents: 1000,
    vectorSpace: '20GB',
    documentsRequestQuota: 2000,
    documentProcessingPriority: Priority.topPriority,
    messageRequest: 10000,
    annotatedResponse: 5000,
    logHistory: NUM_INFINITE,
  },
}

export const defaultPlan = {
  type: Plan.sandbox,
  usage: {
    documents: 50,
    vectorSpace: 1,
    buildApps: 1,
    teamMembers: 1,
    annotatedResponse: 1,
    documentsRequestQuota: 1,
  },
  total: {
    documents: 50,
    vectorSpace: 10,
    buildApps: 10,
    teamMembers: 1,
    annotatedResponse: 10,
    documentsRequestQuota: 50,
  },
}
