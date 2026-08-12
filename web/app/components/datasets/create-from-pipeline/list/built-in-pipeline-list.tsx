import { useSuspenseQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { useLocale } from '@/context/i18n'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { LanguagesSupported } from '@/i18n-config/language'
import { usePipelineTemplateList } from '@/service/use-pipeline'
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
  const { data: pipelineList, isLoading } = usePipelineTemplateList(
    { type: 'built-in', language },
    enableMarketplace,
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
