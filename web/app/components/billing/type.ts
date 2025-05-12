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

export type BasicPlan = Plan.sandbox | Plan.professional | Plan.team

export type PlanInfo = {
  level: number
  price: number
  modelProviders: string
  teamWorkspace: number
  teamMembers: number
  buildApps: number
  documents: number
  vectorSpace: string
  documentsUploadQuota: number
  documentsRequestQuota: number
  apiRateLimit: number
  documentProcessingPriority: Priority
  logHistory: number
  messageRequest: number
  annotatedResponse: number
}

export enum SelfHostedPlan {
  community = 'community',
  premium = 'premium',
  enterprise = 'enterprise',
}

export type SelfHostedPlanInfo = {
  level: number
  price: number
  modelProviders: string
  teamWorkspace: number
  teamMembers: number
  buildApps: number
  documents: number
  vectorSpace: string
  documentsRequestQuota: number
  documentProcessingPriority: Priority
  logHistory: number
  messageRequest: number
  annotatedResponse: number
}

export type UsagePlanInfo = Pick<PlanInfo, 'buildApps' | 'teamMembers' | 'annotatedResponse' | 'documentsUploadQuota'> & { vectorSpace: number }

export enum DocumentProcessingPriority {
  standard = 'standard',
  priority = 'priority',
  topPriority = 'top-priority',
}

export type CurrentPlanInfoBackend = {
  billing: {
    enabled: boolean
    subscription: {
      plan: BasicPlan
    }
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
  annotation_quota_limit: {
    size: number
    limit: number // total. 0 means unlimited
  }
  documents_upload_quota: {
    size: number
    limit: number // total. 0 means unlimited
  }
  docs_processing: DocumentProcessingPriority
  can_replace_logo: boolean
  model_load_balancing_enabled: boolean
  dataset_operator_enabled: boolean
  education: {
    enabled: boolean
    activated: boolean
  }
}

export type SubscriptionItem = {
  plan: Plan
  url: string
}

export type SubscriptionUrlsBackend = {
  url: string
}
