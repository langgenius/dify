import { useQuery } from '@tanstack/react-query'
import { getMarketplaceApiUrl } from '@/features/marketplace/api'
import { marketplaceQuery } from '@/service/marketplace'

export const useMarketplaceTemplateDetail = (templateId: string | null) => {
  return useQuery({
    ...marketplaceQuery.templateDetail.queryOptions({
      input: { params: { templateId: templateId ?? '' } },
    }),
    enabled: !!templateId,
  })
}

export const fetchMarketplaceTemplateDSL = async (templateId: string): Promise<string> => {
  const response = await fetch(getMarketplaceApiUrl(`templates/${templateId}/dsl`))
  if (!response.ok) throw new Error(`Failed to fetch DSL: ${response.statusText}`)
  return response.text()
}
