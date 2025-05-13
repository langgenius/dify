import {
  GeneralChunk,
  ParentChildChunk,
  QuestionAndAnswer,
} from '@/app/components/base/icons/src/vender/knowledge'
import { EffectColor, type Option } from './types'
import { ChunkingMode } from '@/models/datasets'

export const useChunkStructure = () => {
  const GeneralOption: Option = {
    id: ChunkingMode.text,
    icon: <GeneralChunk className='size-[18px] text-util-colors-indigo-indigo-600' />,
    title: 'General',
    description: 'General text chunking mode, the chunks retrieved and recalled are the same.',
    effectColor: EffectColor.indigo,
    showEffectColor: true,
  }
  const ParentChildOption: Option = {
    id: ChunkingMode.parentChild,
    icon: <ParentChildChunk className='size-[18px] text-util-colors-blue-light-blue-light-500' />,
    title: 'Parent-Child',
    description: 'When using the parent-child mode, the child-chunk is used for retrieval and the parent-chunk is used for recall as context.',
    effectColor: EffectColor.blueLight,
    showEffectColor: true,
  }
  const QuestionAnswerOption: Option = {
    id: ChunkingMode.qa,
    icon: <QuestionAndAnswer className='size-[18px] text-text-tertiary' />,
    title: 'Q&A',
    description: 'When using structured Q&A data, you can create documents that pair questions with answers. These documents are indexed based on the question portion, allowing the system to retrieve relevant answers based on query similarity',
  }

  const options = [
    GeneralOption,
    ParentChildOption,
    QuestionAnswerOption,
  ]

  return {
    options,
  }
}
