import { ChunkingMode } from '@/models/datasets'
import TemplateCard from './template-card'
import { usePipelineTemplateList } from '@/service/use-pipeline'
import type { PipelineTemplate } from '@/models/pipeline'

const CustomizedList = () => {
  const mockData: PipelineTemplate[] = [{
    id: '1',
    name: 'Pipeline 1',
    description: 'This is a description of Pipeline 1. When use the general chunking mode, the chunks retrieved and recalled are the same. When use the general chunking mode, the chunks retrieved and recalled are the same.',
    icon_info: {
      icon: '🤖',
      icon_background: '#F0FDF9',
      icon_type: 'emoji',
    },
    doc_form: ChunkingMode.text,
    position: 0,
  }, {
    id: '2',
    name: 'Pipeline 2',
    description: 'This is a description of Pipeline 2. When use the general chunking mode, the chunks retrieved and recalled are the same.',
    icon_info: {
      icon: '🏖️',
      icon_background: '#FFF4ED',
      icon_type: 'emoji',
    },
    doc_form: ChunkingMode.parentChild,
    position: 1,
  }, {
    id: '3',
    name: 'Pipeline 3',
    description: 'This is a description of Pipeline 3',
    icon_info: {
      icon: '🚀',
      icon_background: '#FEFBE8',
      icon_type: 'emoji',
    },
    doc_form: ChunkingMode.qa,
    position: 2,
  }, {
    id: '4',
    name: 'Pipeline 4',
    description: 'This is a description of Pipeline 4',
    icon_info: {
      icon: '🍯',
      icon_background: '#F5F3FF',
      icon_type: 'emoji',
    },
    doc_form: ChunkingMode.graph,
    position: 3,
  }]

  const { data: pipelineList, isLoading } = usePipelineTemplateList({ type: 'customized' })
  const list = pipelineList?.pipelines || mockData

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
