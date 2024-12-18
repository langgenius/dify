import React, { type FC } from 'react'
import { useTranslation } from 'react-i18next'
import { ChuckingMode } from '@/models/datasets'
import AutoHeightTextarea from '@/app/components/base/auto-height-textarea/common'

type IChunkContentProps = {
  question: string
  answer?: string
  onQuestionChange: (question: string) => void
  onAnswerChange?: (answer: string) => void
  isEditMode?: boolean
  docForm: ChuckingMode
}

const ChunkContent: FC<IChunkContentProps> = ({
  question,
  answer,
  onQuestionChange,
  onAnswerChange,
  isEditMode,
  docForm,
}) => {
  const { t } = useTranslation()

  if (docForm === ChuckingMode.qa) {
    return (
      <>
        <div className='text-text-tertiary text-xs font-medium'>QUESTION</div>
        <AutoHeightTextarea
          outerClassName='mb-6 mt-1'
          className='text-text-secondary text-sm tracking-[-0.07px] caret-[#295EFF]'
          value={question}
          placeholder={t('datasetDocuments.segment.questionPlaceholder') || ''}
          onChange={e => onQuestionChange(e.target.value)}
          disabled={!isEditMode}
        />
        <div className='text-text-tertiary text-xs font-medium'>ANSWER</div>
        <AutoHeightTextarea
          outerClassName='mb-6 mt-1'
          className='text-text-secondary text-sm tracking-[-0.07px] caret-[#295EFF]'
          value={answer}
          placeholder={t('datasetDocuments.segment.answerPlaceholder') || ''}
          onChange={e => onAnswerChange?.(e.target.value)}
          disabled={!isEditMode}
          autoFocus
        />
      </>
    )
  }

  return (
    <AutoHeightTextarea
      outerClassName='mb-6'
      className='body-md-regular text-text-secondary tracking-[-0.07px] caret-[#295EFF]'
      value={question}
      placeholder={t('datasetDocuments.segment.contentPlaceholder') || ''}
      onChange={e => onQuestionChange(e.target.value)}
      disabled={!isEditMode}
      autoFocus
    />
  )
}

ChunkContent.displayName = 'ChunkContent'

export default React.memo(ChunkContent)
