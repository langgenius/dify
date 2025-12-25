import type { Option } from './types'
import { useTranslation } from 'react-i18next'
import {
  GeneralChunk,
  ParentChildChunk,
  QuestionAndAnswer,
} from '@/app/components/base/icons/src/vender/knowledge'
import { ChunkingMode } from '@/models/datasets'
import { EffectColor } from './types'

export const useChunkStructure = () => {
  const { t } = useTranslation()

  const GeneralOption: Option = {
    id: ChunkingMode.text,
    icon: <GeneralChunk className="size-[18px]" />,
    iconActiveColor: 'text-util-colors-indigo-indigo-600',
    title: 'General',
    description: t('datasetCreation.stepTwo.generalTip'),
    effectColor: EffectColor.indigo,
    showEffectColor: true,
  }
  const ParentChildOption: Option = {
    id: ChunkingMode.parentChild,
    icon: <ParentChildChunk className="size-[18px]" />,
    iconActiveColor: 'text-util-colors-blue-light-blue-light-500',
    title: 'Parent-Child',
    description: t('datasetCreation.stepTwo.parentChildTip'),
    effectColor: EffectColor.blueLight,
    showEffectColor: true,
  }
  const QuestionAnswerOption: Option = {
    id: ChunkingMode.qa,
    icon: <QuestionAndAnswer className="size-[18px]" />,
    title: 'Q&A',
    description: t('datasetCreation.stepTwo.qaTip'),
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
