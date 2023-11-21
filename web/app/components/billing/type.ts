export enum Plan {
  sandbox = 'sandbox',
  professional = 'professional',
  team = 'team',
  enterprise = 'enterprise',
}

export type PlanInfo = {
  vectorSpace: number
  buildApps: number
}
