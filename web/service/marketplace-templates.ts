import { useQuery } from '@tanstack/react-query'
import { MARKETPLACE_API_PREFIX } from '@/config'
import { marketplaceQuery } from './client'

export const useMarketplaceTemplateDetail = (templateId: string | null) => {
  return useQuery({
    ...marketplaceQuery.templateDetail.queryOptions({ input: { params: { templateId: templateId ?? '' } } }),
    enabled: !!templateId,
  })
}

export const fetchMarketplaceTemplateDSL = async (templateId: string): Promise<string> => {
  const url = `${MARKETPLACE_API_PREFIX}/templates/${templateId}/dsl`
  const response = await fetch(url)
  if (!response.ok)
    throw new Error(`Failed to fetch DSL: ${response.statusText}`)
  return response.text()
}
