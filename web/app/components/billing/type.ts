export enum Plan {
  sandbox = 'sandbox',
  professional = 'professional',
  team = 'team',
  enterprise = 'enterprise',
}

export type PlanInfo = {
  price: number
  modelProviders: string
  teamMembers: number
  buildApps: number
  vectorSpace: number
}

export type UsagePlanInfo = Pick<PlanInfo, 'vectorSpace' | 'buildApps'>
