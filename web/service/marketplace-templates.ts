import { useQuery } from '@tanstack/react-query'
import { MARKETPLACE_API_PREFIX } from '@/config'
import { marketplaceClient, marketplaceQuery } from '@/service/client'

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

export const useMarketplaceTemplateDetail = (templateId: string) => {
  return useQuery({
    queryKey: marketplaceQuery.templateDetail.queryKey({
      input: { params: { templateId } },
    }),
    queryFn: () => marketplaceClient.templateDetail({ params: { templateId } }),
    enabled: !!templateId,
  })
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
