export type WorkflowRetryConfig = {
  max_retries: number
  retry_interval: number
  retry_enabled: boolean
  // First token timeout for LLM nodes (seconds), 0 means no timeout
  first_token_timeout?: number
}
