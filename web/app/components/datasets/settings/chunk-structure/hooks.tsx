import type { Option } from './types'
import { useTranslation } from 'react-i18next'
import { ChunkingMode } from '@/models/datasets'
import { EffectColor } from './types'

export const useChunkStructure = () => {
  const { t } = useTranslation()

  const GeneralOption: Option = {
    id: ChunkingMode.text,
    icon: <span aria-hidden className="i-custom-vender-knowledge-general-chunk size-4.5" />,
    iconActiveColor: 'text-util-colors-indigo-indigo-600',
    title: 'General',
    description: t(($) => $['stepTwo.generalTip'], { ns: 'datasetCreation' }),
    effectColor: EffectColor.indigo,
    showEffectColor: true,
  }
  const ParentChildOption: Option = {
    id: ChunkingMode.parentChild,
    icon: <span aria-hidden className="i-custom-vender-knowledge-parent-child-chunk size-4.5" />,
    iconActiveColor: 'text-util-colors-blue-light-blue-light-500',
    title: 'Parent-Child',
    description: t(($) => $['stepTwo.parentChildTip'], { ns: 'datasetCreation' }),
    effectColor: EffectColor.blueLight,
    showEffectColor: true,
  }
  const QuestionAnswerOption: Option = {
    id: ChunkingMode.qa,
    icon: <span aria-hidden className="i-custom-vender-knowledge-question-and-answer size-4.5" />,
    title: 'Q&A',
    description: t(($) => $['stepTwo.qaTip'], { ns: 'datasetCreation' }),
  }

  const options = [GeneralOption, ParentChildOption, QuestionAnswerOption]

  return {
    options,
  }
}
