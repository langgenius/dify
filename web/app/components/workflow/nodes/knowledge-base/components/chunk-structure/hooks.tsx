import { useState } from 'react'
import {
  GeneralChunk,
  ParentChildChunk,
  QuestionAndAnswer,
} from '@/app/components/base/icons/src/vender/knowledge'
import type { Option } from './type'

export const useChunkStructure = () => {
  const [chunk, setChunk] = useState('general')
  const GeneralOption: Option = {
    key: 'general',
    icon: <GeneralChunk className='h-[18px] w-[18px] text-util-colors-indigo-indigo-600' />,
    title: 'General',
    description: 'General text chunking mode, the chunks retrieved and recalled are the same.',
    effectColor: 'blue',
    showEffectColor: true,
  }
  const ParentChildOption: Option = {
    key: 'parent-child',
    icon: <ParentChildChunk className='h-[18px] w-[18px] text-util-colors-blue-light-blue-light-500' />,
    title: 'Parent-Child',
    description: 'Parent-child text chunking mode, the chunks retrieved and recalled are different.',
    effectColor: 'blue-light',
    showEffectColor: true,
  }
  const QuestionAnswerOption: Option = {
    key: 'question-answer',
    icon: <QuestionAndAnswer className='h-[18px] w-[18px] text-text-tertiary' />,
    title: 'Question-Answer',
    description: 'Question-answer text chunking mode, the chunks retrieved and recalled are different.',
  }

  const optionMap: Record<string, Option> = {
    'general': GeneralOption,
    'parent-child': ParentChildOption,
    'question-answer': QuestionAnswerOption,
  }

  const options = [
    GeneralOption,
    ParentChildOption,
    QuestionAnswerOption,
  ]

  return {
    options,
    optionMap,
    chunk,
    setChunk,
  }
}
