import type { Option } from './type'
import { useTranslation } from 'react-i18next'
import {
  GeneralChunk,
  ParentChildChunk,
  QuestionAndAnswer,
} from '@/app/components/base/icons/src/vender/knowledge'
import { cn } from '@/utils/classnames'
import { ChunkStructureEnum } from '../../types'

export const useChunkStructure = () => {
  const { t } = useTranslation()
  const GeneralOption: Option = {
    id: ChunkStructureEnum.general,
    icon: (isActive: boolean) => (
      <GeneralChunk
        className={cn(
          'h-[18px] w-[18px] text-text-tertiary group-hover:text-util-colors-indigo-indigo-600',
          isActive && 'text-util-colors-indigo-indigo-600',
        )}
      />
    ),
    title: t('stepTwo.general', { ns: 'datasetCreation' }),
    description: t('stepTwo.generalTip', { ns: 'datasetCreation' }),
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
    title: t('stepTwo.parentChild', { ns: 'datasetCreation' }),
    description: t('stepTwo.parentChildTip', { ns: 'datasetCreation' }),
    effectColor: 'blue-light',
  }
  const QuestionAnswerOption: Option = {
    id: ChunkStructureEnum.question_answer,
    icon: (isActive: boolean) => (
      <QuestionAndAnswer
        className={cn(
          'h-[18px] w-[18px] text-text-tertiary group-hover:text-util-colors-teal-teal-600',
          isActive && 'text-util-colors-teal-teal-600',
        )}
      />
    ),
    title: 'Q&A',
    description: t('stepTwo.qaTip', { ns: 'datasetCreation' }),
    effectColor: 'teal',
  }

  const optionMap: Record<ChunkStructureEnum, Option> = {
    [ChunkStructureEnum.general]: GeneralOption,
    [ChunkStructureEnum.parent_child]: ParentChildOption,
    [ChunkStructureEnum.question_answer]: QuestionAnswerOption,
  }

  const options = [
    GeneralOption,
    ParentChildOption,
    QuestionAnswerOption,
  ]

  return {
    options,
    optionMap,
  }
}
