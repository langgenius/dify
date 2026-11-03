type DocumentProcessingPriority = 'standard' | 'priority' | 'top-priority'
type WorkflowExecutionSpeed = 'standard' | 'faster' | 'priority'

type PlanQuota = {
  count: number
  perMonth: boolean
}

export type PlanInfo = {
  level: number
  price: number
  messageRequest: PlanQuota
  teamMembers: number
  buildApps: number
  documents: number
  vectorSpace: string
  documentsRequestQuota: number
  documentProcessingPriority: DocumentProcessingPriority
  triggerEvents: PlanQuota | 'unlimited'
  startNodes: number | 'unlimited'
  workflowExecution: WorkflowExecutionSpeed
  annotatedResponse: number
  logHistory: number | 'unlimited'
  apiRateLimit: number | 'unlimited'
}
