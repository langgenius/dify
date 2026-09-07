type DocumentProcessingPriority = 'standard' | 'priority' | 'top-priority'

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
  documentProcessingPriority: DocumentProcessingPriority
  logHistory: number
  messageRequest: number
  triggerEvents: number
  annotatedResponse: number
}

export type UsagePlanInfo = {
  buildApps: number
  teamMembers: number
  annotatedResponse: number
  documentsUploadQuota: number
  apiRateLimit: number
  triggerEvents: number
  vectorSpace: number
}

export type UsageResetInfo = {
  apiRateLimit?: number | null
  triggerEvents?: number | null
}
