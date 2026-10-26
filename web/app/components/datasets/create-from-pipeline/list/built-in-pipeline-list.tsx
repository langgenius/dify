import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { useLocale } from '#i18n'
import { selectPipelineTemplateList } from '@/app/components/rag-pipeline/utils/query-select'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { LanguagesSupported } from '@/i18n/language'
import { consoleQuery } from '@/service/console'
import CreateCard from './create-card'
import TemplateCard from './template-card'

const BuiltInPipelineList = () => {
  const locale = useLocale()
  const language = useMemo(() => {
    if (['zh-Hans', 'ja-JP'].includes(locale)) return locale
    return LanguagesSupported[0]
  }, [locale])
  const { data: enableMarketplace } = useSuspenseQuery({
    ...systemFeaturesQueryOptions(),
    select: (s) => s.enable_marketplace,
  })
  const { data: pipelineList, isLoading } = useQuery(
    consoleQuery.rag.pipeline.templates.get.queryOptions({
      input: { query: { type: 'built-in', language } },
      enabled: enableMarketplace,
      select: selectPipelineTemplateList,
    }),
  )
  const list = pipelineList?.pipeline_templates || []

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(296px,1fr))] gap-3 py-2">
      <CreateCard />
      {!isLoading &&
        list.map((pipeline, index) => (
          <TemplateCard
            key={index}
            type="built-in"
            pipeline={pipeline}
            showMoreOperations={false}
          />
        ))}
    </div>
  )
}

export default BuiltInPipelineList
