import { GeneralChunk, ParentChildChunk, QuestionAndAnswer } from '@/app/components/base/icons/src/vender/knowledge'
import { useTranslation } from 'react-i18next'
import { EffectColor, type Option } from './types'
import { ChunkingMode } from '@/models/datasets'

export const useChunkStructureConfig = () => {
  const { t } = useTranslation()

  const GeneralOption: Option = {
    icon: <GeneralChunk className='size-4' />,
    title: 'General',
    description: t('datasetCreation.stepTwo.generalTip'),
    effectColor: EffectColor.indigo,
  }
  const ParentChildOption: Option = {
    icon: <ParentChildChunk className='size-4' />,
    title: 'Parent-Child',
    description: t('datasetCreation.stepTwo.parentChildTip'),
    effectColor: EffectColor.blueLight,
  }
  const QuestionAnswerOption: Option = {
    icon: <QuestionAndAnswer className='size-4' />,
    title: 'Q&A',
    description: t('datasetCreation.stepTwo.qaTip'),
    effectColor: EffectColor.green,

  }

  const chunkStructureConfig: Record<ChunkingMode, Option> = {
    [ChunkingMode.text]: GeneralOption,
    [ChunkingMode.parentChild]: ParentChildOption,
    [ChunkingMode.qa]: QuestionAnswerOption,
  }

  return chunkStructureConfig
}
