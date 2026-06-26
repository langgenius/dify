export type EnterpriseMarketplaceAssetStatus = 'pending' | 'approved' | 'rejected' | 'unlisted'

export type EnterpriseMarketplaceAsset = {
  id: string
  source_tenant_id: string
  source_app_id: string
  status: EnterpriseMarketplaceAssetStatus
  title: string
  description: string
  category: string
  tags: string[]
  scenario: string
  allow_show_workspace_name: boolean
  source_workspace_name?: string | null
  submitter_account_id: string
  submitter_name?: string | null
  reviewer_account_id?: string | null
  review_note?: string | null
  reviewed_at?: number | null
  created_at: number
  updated_at: number
  app_name: string
  app_description: string
  app_mode: string
  app_icon_type?: string | null
  app_icon?: string | null
  app_icon_background?: string | null
}

export type EnterpriseMarketplaceAssetListResponse = {
  items: EnterpriseMarketplaceAsset[]
  page: number
  limit: number
  total: number
}

export type EnterpriseMarketplaceSubmissionListResponse = {
  items: EnterpriseMarketplaceAsset[]
}

export type EnterpriseMarketplaceUseResponse = {
  import_result: {
    id: string
    status: 'completed' | 'completed-with-warnings' | 'pending' | 'failed'
    app_id?: string
    app_mode?: string
    current_dsl_version?: string
    imported_dsl_version?: string
    error: string
  }
  leaked_dependencies: Array<Record<string, unknown>>
}
