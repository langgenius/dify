import { ChunkingMode } from '@/models/datasets'
import TemplateCard from './template-card'

export type Pipeline = {
  id: string
  name: string
  icon_type: 'emoji' | 'image'
  icon?: string
  icon_background?: string
  file_id?: string
  url?: string
  description: string
  doc_form: ChunkingMode
}

const BuiltInPipelineList = () => {
  const mockData: Pipeline[] = [{
    id: '1',
    name: 'Pipeline 1',
    description: 'This is a description of Pipeline 1. When use the general chunking mode, the chunks retrieved and recalled are the same. When use the general chunking mode, the chunks retrieved and recalled are the same.',
    icon_type: 'emoji',
    icon: '🤖',
    icon_background: '#F0FDF9',
    doc_form: ChunkingMode.text,
  }, {
    id: '2',
    name: 'Pipeline 2',
    description: 'This is a description of Pipeline 2. When use the general chunking mode, the chunks retrieved and recalled are the same.',
    icon_type: 'emoji',
    icon: '🏖️',
    icon_background: '#FFF4ED',
    doc_form: ChunkingMode.parentChild,
  }, {
    id: '3',
    name: 'Pipeline 3',
    description: 'This is a description of Pipeline 3',
    icon_type: 'emoji',
    icon: '🚀',
    icon_background: '#FEFBE8',
    doc_form: ChunkingMode.qa,
  }, {
    id: '4',
    name: 'Pipeline 4',
    description: 'This is a description of Pipeline 4',
    icon_type: 'emoji',
    icon: '🍯',
    icon_background: '#F5F3FF',
    doc_form: ChunkingMode.graph,
  }]

  return (
    <div className='grid grow grid-cols-1 gap-3 overflow-y-auto px-16 pt-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4'>
      {mockData.map((pipeline, index) => (
        <TemplateCard
          key={index}
          pipeline={pipeline}
          showMoreOperations={false}
        />
      ))}
    </div>
  )
}

export default BuiltInPipelineList
