import TemplateCard from './template-card'
import { usePipelineTemplateList } from '@/service/use-pipeline'

const CustomizedList = () => {
  const { data: pipelineList, isLoading } = usePipelineTemplateList({ type: 'customized' })
  const list = pipelineList?.pipelines

  if (isLoading || !list)
    return null

  return (
    <div className='grid grow grid-cols-1 gap-3 overflow-y-auto px-16 pt-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4'>
      {list.map((pipeline, index) => (
        <TemplateCard
          key={index}
          pipeline={pipeline}
        />
      ))}
    </div>
  )
}

export default CustomizedList
