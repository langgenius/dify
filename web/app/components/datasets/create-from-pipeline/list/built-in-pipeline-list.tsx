import { usePipelineTemplateList } from '@/service/use-pipeline'
import TemplateCard from './template-card'

const BuiltInPipelineList = () => {
  const { data: pipelineList, isLoading } = usePipelineTemplateList({ type: 'built-in' })
  const list = pipelineList?.pipeline_templates

  if (isLoading || !list)
    return null

  return (
    <div className='grid grow grid-cols-1 gap-3 overflow-y-auto px-16 pt-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4'>
      {list.map((pipeline, index) => (
        <TemplateCard
          key={index}
          type='built-in'
          pipeline={pipeline}
          showMoreOperations={false}
        />
      ))}
    </div>
  )
}

export default BuiltInPipelineList
