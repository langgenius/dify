import TemplateCard from './template-card'
import { usePipelineTemplateList } from '@/service/use-pipeline'

const CustomizedList = () => {
  const { data: pipelineList, isLoading } = usePipelineTemplateList({ type: 'customized' })
  const list = pipelineList?.pipeline_templates

  if (isLoading || !list)
    return null

  return (
    <div className='grid grid-cols-1 gap-3 py-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4'>
      {list.map((pipeline, index) => (
        <TemplateCard
          key={index}
          type='customized'
          pipeline={pipeline}
        />
      ))}
    </div>
  )
}

export default CustomizedList
