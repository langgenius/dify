export type PromptTemplate = {
  id: string
  name: string
  mode: string
  description?: string
  tags?: string[]
  prompt_content?: string
  model_settings?: {
    model_name: string
    parameters: Record<string, any>
  }
  created_at: string
  updated_at: string
}

export type PromptTemplateRequest = {
  name: string
  mode: string
  prompt_content: string
  description?: string
  tags?: string[]
  model_name?: string
  model_parameters?: Record<string, any>
} 