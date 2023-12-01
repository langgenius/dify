export enum Plan {
  sandbox = 'sandbox',
  professional = 'professional',
  team = 'team',
  enterprise = 'enterprise',
}

export enum Priority {
  standard = 'standard',
  priority = 'priority',
  topPriority = 'top-priority',
}
export type PlanInfo = {
  level: number
  price: number
  modelProviders: string
  teamMembers: number
  buildApps: number
  vectorSpace: number
  documentProcessingPriority: Priority
  logHistory: number
}

export type UsagePlanInfo = Pick<PlanInfo, 'vectorSpace' | 'buildApps' | 'teamMembers'>

export enum DocumentProcessingPriority {
  standard = 'standard',
  priority = 'priority',
  topPriority = 'top-priority',
}

export type CurrentPlanInfoBackend = {
  enabled: boolean
  subscription: {
    plan: Plan
  }
  members: {
    size: number
    limit: number // total. 0 means unlimited
  }
  apps: {
    size: number
    limit: number // total. 0 means unlimited
  }
  vector_space: {
    size: number
    limit: number // total. 0 means unlimited
  }
  docs_processing: DocumentProcessingPriority
}

export type SubscriptionItem = {
  plan: Plan
  url: string
}

export type SubscriptionUrlsBackend = {
  url: string
}
