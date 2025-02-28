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
  documentsUploadQuota: number
  documentProcessingPriority: Priority
  logHistory: number
  customTools: string | number
  messageRequest: {
    en: string | number
    zh: string | number
  }
  annotatedResponse: number
}

export type UsagePlanInfo = Pick<PlanInfo, 'vectorSpace' | 'buildApps' | 'teamMembers' | 'annotatedResponse' | 'documentsUploadQuota'>

export enum DocumentProcessingPriority {
  standard = 'standard',
  priority = 'priority',
  topPriority = 'top-priority',
}

export type CurrentPlanInfoBackend = {
  billing: {
    enabled: boolean
    subscription: {
      plan: Plan
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
}

export type SubscriptionItem = {
  plan: Plan
  url: string
}

export type SubscriptionUrlsBackend = {
  url: string
}
