export const Plan = {
  sandbox: 'sandbox',
  professional: 'professional',
  team: 'team',
  enterprise: 'enterprise',
} as const
export type Plan = typeof Plan[keyof typeof Plan]

export const Priority = {
  standard: 'standard',
  priority: 'priority',
  topPriority: 'top-priority',
} as const
export type Priority = typeof Priority[keyof typeof Priority]

export type BasicPlan = typeof Plan['sandbox'] | typeof Plan['professional'] | typeof Plan['team']

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
  triggerEvents: number
  annotatedResponse: number
}

export const SelfHostedPlan = {
  community: 'community',
  premium: 'premium',
  enterprise: 'enterprise',
} as const
export type SelfHostedPlan = typeof SelfHostedPlan[keyof typeof SelfHostedPlan]

export type UsagePlanInfo = Pick<PlanInfo, 'buildApps' | 'teamMembers' | 'annotatedResponse' | 'documentsUploadQuota' | 'apiRateLimit' | 'triggerEvents'> & { vectorSpace: number }

export type UsageResetInfo = {
  apiRateLimit?: number | null
  triggerEvents?: number | null
}

export type BillingQuota = {
  usage: number
  limit: number
  reset_date?: number | null
}

export const DocumentProcessingPriority = {
  standard: 'standard',
  priority: 'priority',
  topPriority: 'top-priority',
} as const
export type DocumentProcessingPriority = typeof DocumentProcessingPriority[keyof typeof DocumentProcessingPriority]

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
  api_rate_limit?: BillingQuota
  trigger_event?: BillingQuota
  docs_processing: DocumentProcessingPriority
  can_replace_logo: boolean
  model_load_balancing_enabled: boolean
  dataset_operator_enabled: boolean
  education: {
    enabled: boolean
    activated: boolean
  }
  webapp_copyright_enabled: boolean
  workspace_members: {
    size: number
    limit: number
  }
  is_allow_transfer_workspace: boolean
  knowledge_pipeline: {
    publish_enabled: boolean
  }
  human_input_email_delivery_enabled: boolean
}

export type SubscriptionUrlsBackend = {
  url: string
}
