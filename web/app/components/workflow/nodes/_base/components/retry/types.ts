export type WorkflowRetryConfig = {
  max_retries: number
  retry_interval: number
  retry_enabled: boolean
  max_retries_upper_bound?: number
  retry_interval_upper_bound?: number
}
