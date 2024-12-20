import React, { useEffect, useRef, useState } from 'react'
import type { ComponentProps, FC } from 'react'
import { useTranslation } from 'react-i18next'
import { ChunkingMode } from '@/models/datasets'
import classNames from '@/utils/classnames'

type IContentProps = ComponentProps<'textarea'>

const Textarea: FC<IContentProps> = React.memo(({
  value,
  placeholder,
  className,
  disabled,
  ...rest
}) => {
  return (
    <textarea
      className={classNames(
        'disabled:bg-transparent inset-0 outline-none border-none appearance-none resize-none w-full overflow-y-auto',
        className,
      )}
      placeholder={placeholder}
      value={value}
      disabled={disabled}
      {...rest}
    />
  )
})

Textarea.displayName = 'Textarea'

type IAutoResizeTextAreaProps = ComponentProps<'textarea'> & {
  containerRef: React.RefObject<HTMLDivElement>
  labelRef: React.RefObject<HTMLDivElement>
}

const AutoResizeTextArea: FC<IAutoResizeTextAreaProps> = React.memo(({
  className,
  placeholder,
  value,
  disabled,
  containerRef,
  labelRef,
  ...rest
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const observerRef = useRef<ResizeObserver>()
  const [maxHeight, setMaxHeight] = useState(0)

  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea)
      return
    textarea.style.height = 'auto'
    const lineHeight = parseInt(getComputedStyle(textarea).lineHeight)
    const textareaHeight = Math.max(textarea.scrollHeight, lineHeight)
    textarea.style.height = `${textareaHeight}px`
  }, [value])

  useEffect(() => {
    const container = containerRef.current
    const label = labelRef.current
    if (!container || !label)
      return
    const updateMaxHeight = () => {
      const containerHeight = container.clientHeight
      const labelHeight = label.clientHeight
      const padding = 32
      const space = 12
      const maxHeight = Math.floor((containerHeight - 2 * labelHeight - padding - space) / 2)
      setMaxHeight(maxHeight)
    }
    updateMaxHeight()
    observerRef.current = new ResizeObserver(updateMaxHeight)
    observerRef.current.observe(container)
    return () => {
      observerRef.current?.disconnect()
    }
  }, [])

  return (
    <textarea
      ref={textareaRef}
      className={classNames(
        'disabled:bg-transparent inset-0 outline-none border-none appearance-none resize-none w-full',
        className,
      )}
      style={{
        maxHeight,
      }}
      placeholder={placeholder}
      value={value}
      disabled={disabled}
      {...rest}
    />
  )
})

AutoResizeTextArea.displayName = 'AutoResizeTextArea'

type IQATextAreaProps = {
  question: string
  answer?: string
  onQuestionChange: (question: string) => void
  onAnswerChange?: (answer: string) => void
  isEditMode?: boolean
}

const QATextArea: FC<IQATextAreaProps> = React.memo(({
  question,
  answer,
  onQuestionChange,
  onAnswerChange,
  isEditMode = true,
}) => {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement>(null)
  const labelRef = useRef<HTMLDivElement>(null)

  return (
    <div ref={containerRef} className='h-full overflow-hidden'>
      <div ref={labelRef} className='text-text-tertiary text-xs font-medium mb-1'>QUESTION</div>
      <AutoResizeTextArea
        className='text-text-secondary text-sm tracking-[-0.07px] caret-[#295EFF]'
        value={question}
        placeholder={t('datasetDocuments.segment.questionPlaceholder') || ''}
        onChange={e => onQuestionChange(e.target.value)}
        disabled={!isEditMode}
        containerRef={containerRef}
        labelRef={labelRef}
      />
      <div className='text-text-tertiary text-xs font-medium mb-1 mt-6'>ANSWER</div>
      <AutoResizeTextArea
        className='text-text-secondary text-sm tracking-[-0.07px] caret-[#295EFF]'
        value={answer}
        placeholder={t('datasetDocuments.segment.answerPlaceholder') || ''}
        onChange={e => onAnswerChange?.(e.target.value)}
        disabled={!isEditMode}
        autoFocus
        containerRef={containerRef}
        labelRef={labelRef}
      />
    </div>
  )
})

QATextArea.displayName = 'QATextArea'

type IChunkContentProps = {
  question: string
  answer?: string
  onQuestionChange: (question: string) => void
  onAnswerChange?: (answer: string) => void
  isEditMode?: boolean
  docForm: ChunkingMode
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

  if (docForm === ChunkingMode.qa) {
    return <QATextArea
      question={question}
      answer={answer}
      onQuestionChange={onQuestionChange}
      onAnswerChange={onAnswerChange}
      isEditMode={isEditMode}
    />
  }

  return (
    <Textarea
      className='h-full w-full pb-6 body-md-regular text-text-secondary tracking-[-0.07px] caret-[#295EFF]'
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
