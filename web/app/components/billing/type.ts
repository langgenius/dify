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
  triggerEvents: number
  annotatedResponse: number
}

export enum SelfHostedPlan {
  community = 'community',
  premium = 'premium',
  enterprise = 'enterprise',
}

export type UsagePlanInfo = Pick<
  PlanInfo,
  | 'buildApps'
  | 'teamMembers'
  | 'annotatedResponse'
  | 'documentsUploadQuota'
  | 'apiRateLimit'
  | 'triggerEvents'
> & { vectorSpace: number }

export type UsageResetInfo = {
  apiRateLimit?: number | null
  triggerEvents?: number | null
}

export enum DocumentProcessingPriority {
  standard = 'standard',
  priority = 'priority',
  topPriority = 'top-priority',
}
