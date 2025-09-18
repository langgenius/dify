import { usePipelineTemplateList } from '@/service/use-pipeline'
import TemplateCard from './template-card'
import CreateCard from './create-card'

const BuiltInPipelineList = () => {
  const { data: pipelineList, isLoading } = usePipelineTemplateList({ type: 'built-in' })
  const list = pipelineList?.pipeline_templates || []

  return (
    <div className='grid grid-cols-1 gap-3 py-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4'>
      <CreateCard />
      {!isLoading && list.map((pipeline, index) => (
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
