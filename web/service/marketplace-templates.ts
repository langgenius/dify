import { useQuery } from '@tanstack/react-query'
import { marketplaceClient, marketplaceQuery } from '@/service/marketplace'

export const useMarketplaceTemplateDetail = (templateId: string | null) => {
  return useQuery({
    ...marketplaceQuery.templateDetail.queryOptions({
      input: { params: { templateId: templateId ?? '' } },
    }),
    enabled: !!templateId,
  })
}

export const fetchMarketplaceTemplateDSL = async (templateId: string): Promise<string> => {
  const dsl = await marketplaceClient.templateDsl({ params: { templateId } })
  return dsl.text()
}
