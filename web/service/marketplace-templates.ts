import { MARKETPLACE_API_PREFIX } from '@/config'

export type MarketplaceTemplate = {
  id: string
  publisher_type: 'individual' | 'organization'
  publisher_unique_handle: string
  template_name: string
  icon: string
  icon_background: string
  icon_file_key: string
  kind: 'classic' | 'sandboxed'
  categories: string[]
  deps_plugins: string[]
  preferred_languages: string[]
  overview: string
  readme: string
  partner_link: string
  version: string
  status: string
  usage_count: number | null
  created_at: string
  updated_at: string
}

type MarketplaceResponse<T> = {
  code: number
  msg: string
  data: T
}

export const fetchMarketplaceTemplateDetail = async (
  templateId: string,
): Promise<MarketplaceTemplate> => {
  const res = await fetch(
    `${MARKETPLACE_API_PREFIX}/templates/${encodeURIComponent(templateId)}`,
    { credentials: 'omit' },
  )
  if (!res.ok)
    throw new Error(`Failed to fetch template: ${res.status}`)

  const json: MarketplaceResponse<MarketplaceTemplate> = await res.json()
  if (json.code !== 0)
    throw new Error(json.msg || 'Failed to fetch template')

  return json.data
}

export const fetchMarketplaceTemplateDSL = async (
  templateId: string,
): Promise<string> => {
  const res = await fetch(
    `${MARKETPLACE_API_PREFIX}/templates/${encodeURIComponent(templateId)}/dsl`,
    { credentials: 'omit' },
  )
  if (!res.ok)
    throw new Error(`Failed to fetch template DSL: ${res.status}`)

  return await res.text()
}
