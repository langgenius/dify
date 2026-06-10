import type { Option } from './types'
import { useTranslation } from 'react-i18next'
import { GeneralChunk, ParentChildChunk, QuestionAndAnswer } from '@/app/components/base/icons/src/vender/knowledge'
import { ChunkingMode } from '@/models/datasets'
import { EffectColor } from './types'

export const useChunkStructureConfig = () => {
  const { t } = useTranslation()

  const GeneralOption: Option = {
    icon: <GeneralChunk className="size-4" />,
    title: 'General',
    description: t('stepTwo.generalTip', { ns: 'datasetCreation' }),
    effectColor: EffectColor.indigo,
  }
  const ParentChildOption: Option = {
    icon: <ParentChildChunk className="size-4" />,
    title: 'Parent-Child',
    description: t('stepTwo.parentChildTip', { ns: 'datasetCreation' }),
    effectColor: EffectColor.blueLight,
  }
  const QuestionAnswerOption: Option = {
    icon: <QuestionAndAnswer className="size-4" />,
    title: 'Q&A',
    description: t('stepTwo.qaTip', { ns: 'datasetCreation' }),
    effectColor: EffectColor.green,

  }

  const chunkStructureConfig: Record<ChunkingMode, Option> = {
    [ChunkingMode.text]: GeneralOption,
    [ChunkingMode.parentChild]: ParentChildOption,
    [ChunkingMode.qa]: QuestionAnswerOption,
  }

  return chunkStructureConfig
}
