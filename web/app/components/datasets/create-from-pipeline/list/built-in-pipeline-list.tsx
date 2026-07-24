import { useMemo } from 'react'
import { useGlobalPublicStore } from '@/context/global-public-context'
import { useLocale } from '@/context/i18n'
import { LanguagesSupported } from '@/i18n-config/language'
import { usePipelineTemplateList } from '@/service/use-pipeline'
import CreateCard from './create-card'
import TemplateCard from './template-card'

const BuiltInPipelineList = () => {
  const locale = useLocale()
  const language = useMemo(() => {
    if (['zh-Hans', 'ja-JP'].includes(locale))
      return locale
    return LanguagesSupported[0]
  }, [locale])
  const enableMarketplace = useGlobalPublicStore(s => s.systemFeatures.enable_marketplace)
  const { data: pipelineList, isLoading } = usePipelineTemplateList({ type: 'built-in', language }, enableMarketplace)
  const list = pipelineList?.pipeline_templates || []

  return (
    <div className="grid grid-cols-1 gap-3 py-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
      <CreateCard />
      {!isLoading && list.map((pipeline, index) => (
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
