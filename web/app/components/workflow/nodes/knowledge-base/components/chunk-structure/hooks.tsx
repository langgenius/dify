import {
  GeneralChunk,
  ParentChildChunk,
  QuestionAndAnswer,
} from '@/app/components/base/icons/src/vender/knowledge'
import cn from '@/utils/classnames'
import { ChunkStructureEnum } from '../../types'
import type { Option } from './type'

export const useChunkStructure = () => {
  const GeneralOption: Option = {
    id: ChunkStructureEnum.general,
    icon: (isActive: boolean) => (
      <GeneralChunk
        className={cn(
          'h-[18px] w-[18px] text-text-tertiary group-hover:text-util-colors-indigo-indigo-600',
          isActive && 'text-util-colors-indigo-indigo-600',
        )} />
    ),
    title: 'General',
    description: 'General text chunking mode, the chunks retrieved and recalled are the same.',
    effectColor: 'blue',
  }
  const ParentChildOption: Option = {
    id: ChunkStructureEnum.parent_child,
    icon: (isActive: boolean) => (
      <ParentChildChunk
        className={cn(
          'h-[18px] w-[18px] text-text-tertiary group-hover:text-util-colors-blue-light-blue-light-500',
          isActive && 'text-util-colors-blue-light-blue-light-500',
        )}
      />
    ),
    title: 'Parent-Child',
    description: 'Parent-child text chunking mode, the chunks retrieved and recalled are different.',
    effectColor: 'blue-light',
  }
  const QuestionAnswerOption: Option = {
    id: ChunkStructureEnum.question_answer,
    icon: <QuestionAndAnswer className='h-[18px] w-[18px] text-text-tertiary' />,
    title: 'Question-Answer',
    description: 'Question-answer text chunking mode, the chunks retrieved and recalled are different.',
  }

  const optionMap: Record<ChunkStructureEnum, Option> = {
    [ChunkStructureEnum.general]: GeneralOption,
    [ChunkStructureEnum.parent_child]: ParentChildOption,
    [ChunkStructureEnum.question_answer]: QuestionAnswerOption,
  }

  const options = [
    GeneralOption,
    ParentChildOption,
    // QuestionAnswerOption,
  ]

  return {
    options,
    optionMap,
  }
}
