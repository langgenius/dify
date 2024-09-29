export type CreateKnowledgeBaseReq = {
  name: string
  description?: string
  external_knowledge_api_id: string
  provider: 'external'
  external_knowledge_id: string
  external_retrieval_model: {
    top_k: number
    score_threshold: number
    score_threshold_enabled: boolean
  }
}
