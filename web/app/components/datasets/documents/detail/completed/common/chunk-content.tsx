import React, { type FC } from 'react'
import { useTranslation } from 'react-i18next'
import AutoHeightTextarea from '@/app/components/base/auto-height-textarea/common'

type IChunkContentProps = {
  question: string
  answer: string
  onQuestionChange: (question: string) => void
  onAnswerChange: (answer: string) => void
  isEditMode?: boolean
  docForm: string
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

  if (docForm === 'qa_model') {
    return (
      <>
        <div className='mb-1 text-xs font-medium text-gray-500'>QUESTION</div>
        <AutoHeightTextarea
          outerClassName='mb-4'
          className='leading-6 text-md text-gray-800'
          value={question}
          placeholder={t('datasetDocuments.segment.questionPlaceholder') || ''}
          onChange={e => onQuestionChange(e.target.value)}
          disabled={!isEditMode}
        />
        <div className='mb-1 text-xs font-medium text-gray-500'>ANSWER</div>
        <AutoHeightTextarea
          outerClassName='mb-4'
          className='leading-6 text-md text-gray-800'
          value={answer}
          placeholder={t('datasetDocuments.segment.answerPlaceholder') || ''}
          onChange={e => onAnswerChange(e.target.value)}
          disabled={!isEditMode}
          autoFocus
        />
      </>
    )
  }

  return (
    <AutoHeightTextarea
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
