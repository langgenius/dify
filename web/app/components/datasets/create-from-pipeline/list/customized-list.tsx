import { useTranslation } from 'react-i18next'
import { useLoadFailureMeta } from '@/hooks/use-load-failure-meta'
import { usePipelineTemplateList } from '@/service/use-pipeline'
import TemplateCard from './template-card'

const CustomizedList = () => {
  const { t } = useTranslation(['datasetPipeline'])
  const { data: pipelineList, isLoading } = usePipelineTemplateList({ type: 'customized' }, true, {
    meta: useLoadFailureMeta(),
  })
  const list = pipelineList?.pipeline_templates || []

  if (isLoading || list.length === 0) return null

  return (
    <>
      <div className="pt-2 system-sm-semibold-uppercase text-text-tertiary">
        {t(($) => $['templates.customized'], { ns: 'datasetPipeline' })}
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(296px,1fr))] gap-3 py-2">
        {list.map((pipeline, index) => (
          <TemplateCard key={index} type="customized" pipeline={pipeline} />
        ))}
      </div>
    </>
  )
}

export default CustomizedList
