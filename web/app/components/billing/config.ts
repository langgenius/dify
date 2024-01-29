import { Plan, type PlanInfo, Priority } from '@/app/components/billing/type'

const supportModelProviders = 'OpenAI/Anthropic/Azure OpenAI/  Llama2/Hugging Face/Replicate'

export const NUM_INFINITE = 99999999
export const contractSales = 'contractSales'
export const unAvailable = 'unAvailable'

export const contactSalesUrl = 'mailto:business@dify.ai'

export const ALL_PLANS: Record<Plan, PlanInfo> = {
  sandbox: {
    level: 1,
    price: 0,
    modelProviders: supportModelProviders,
    teamMembers: 1,
    buildApps: 10,
    vectorSpace: 5,
    documentProcessingPriority: Priority.standard,
    logHistory: 30,
    customTools: unAvailable,
    messageRequest: {
      en: '200 messages',
      zh: '200 条信息',
    },
    annotatedResponse: 10,
  },
  professional: {
    level: 2,
    price: 59,
    modelProviders: supportModelProviders,
    teamMembers: 3,
    buildApps: 50,
    vectorSpace: 200,
    documentProcessingPriority: Priority.priority,
    logHistory: NUM_INFINITE,
    customTools: 10,
    messageRequest: {
      en: '5,000  messages/month',
      zh: '5,000 条信息/月',
    },
    annotatedResponse: 2000,
  },
  team: {
    level: 3,
    price: 159,
    modelProviders: supportModelProviders,
    teamMembers: NUM_INFINITE,
    buildApps: NUM_INFINITE,
    vectorSpace: 1000,
    documentProcessingPriority: Priority.topPriority,
    logHistory: NUM_INFINITE,
    customTools: NUM_INFINITE,
    messageRequest: {
      en: '10,000  messages/month',
      zh: '10,000 条信息/月',
    },
    annotatedResponse: 5000,
  },
  enterprise: {
    level: 4,
    price: 0,
    modelProviders: supportModelProviders,
    teamMembers: NUM_INFINITE,
    buildApps: NUM_INFINITE,
    vectorSpace: NUM_INFINITE,
    documentProcessingPriority: Priority.topPriority,
    logHistory: NUM_INFINITE,
    customTools: NUM_INFINITE,
    messageRequest: {
      en: contractSales,
      zh: contractSales,
    },
    annotatedResponse: NUM_INFINITE,
  },
}

export const defaultPlan = {
  type: Plan.sandbox,
  usage: {
    vectorSpace: 1,
    buildApps: 1,
    teamMembers: 1,
    annotatedResponse: 1,
  },
  total: {
    vectorSpace: 10,
    buildApps: 10,
    teamMembers: 1,
    annotatedResponse: 10,
  },
}
