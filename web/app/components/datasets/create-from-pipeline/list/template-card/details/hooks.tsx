import type { Option } from './types'
import { useTranslation } from 'react-i18next'
import { ChunkingMode } from '@/models/datasets'
import { EffectColor } from './types'

export const useChunkStructureConfig = () => {
  const { t } = useTranslation()

  const GeneralOption: Option = {
    icon: <span aria-hidden className="i-custom-vender-knowledge-general-chunk size-4" />,
    title: 'General',
    description: t(($) => $['stepTwo.generalTip'], { ns: 'datasetCreation' }),
    effectColor: EffectColor.indigo,
  }
  const ParentChildOption: Option = {
    icon: <span aria-hidden className="i-custom-vender-knowledge-parent-child-chunk size-4" />,
    title: 'Parent-Child',
    description: t(($) => $['stepTwo.parentChildTip'], { ns: 'datasetCreation' }),
    effectColor: EffectColor.blueLight,
  }
  const QuestionAnswerOption: Option = {
    icon: <span aria-hidden className="i-custom-vender-knowledge-question-and-answer size-4" />,
    title: 'Q&A',
    description: t(($) => $['stepTwo.qaTip'], { ns: 'datasetCreation' }),
    effectColor: EffectColor.green,
  }

  const chunkStructureConfig: Record<ChunkingMode, Option> = {
    [ChunkingMode.text]: GeneralOption,
    [ChunkingMode.parentChild]: ParentChildOption,
    [ChunkingMode.qa]: QuestionAnswerOption,
  }

  return chunkStructureConfig
}
