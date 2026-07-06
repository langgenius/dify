export enum RetryConditionOperator {
  contains = 'contains',
  notContains = 'not-contains',
  startsWith = 'starts-with',
  endsWith = 'ends-with',
  equals = 'equals',
  notEquals = 'not-equals',
  regex = 'regex',
}

export type RetryCondition = {
  enabled: boolean
  error_filter: {
    operator: RetryConditionOperator
    value: string
  }
}

export type WorkflowRetryConfig = {
  max_retries: number
  retry_interval: number
  retry_enabled: boolean
}
