export enum Plan {
  sandbox = 'sandbox',
  professional = 'professional',
  team = 'team',
  enterprise = 'enterprise',
}
export enum Priority {
  standard = 'standard',
  priority = 'priority',
  topPriority = 'topPriority',
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

export type UsagePlanInfo = Pick<PlanInfo, 'vectorSpace' | 'buildApps'>

export enum DocumentProcessingPriority {
  standard = 'standard',
  priority = 'priority',
  topPriority = 'topPriority',
}
