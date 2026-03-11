import { useTranslation } from 'react-i18next'
import { usePipelineTemplateList } from '@/service/use-pipeline'
import TemplateCard from './template-card'

const CustomizedList = () => {
  const { t } = useTranslation()
  const { data: pipelineList, isLoading } = usePipelineTemplateList({ type: 'customized' })
  const list = pipelineList?.pipeline_templates || []

  if (isLoading || list.length === 0)
    return null

  return (
    <>
      <div className="system-sm-semibold-uppercase pt-2 text-text-tertiary">{t('templates.customized', { ns: 'datasetPipeline' })}</div>
      <div className="grid grid-cols-1 gap-3 py-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
        {list.map((pipeline, index) => (
          <TemplateCard
            key={index}
            type="customized"
            pipeline={pipeline}
          />
        ))}
      </div>
    </>
  )
}

export default CustomizedList
