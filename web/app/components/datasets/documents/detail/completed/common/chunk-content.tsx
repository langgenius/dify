import type { TextareaProps } from '@langgenius/dify-ui/textarea'
import type { FC } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { Textarea } from '@langgenius/dify-ui/textarea'
import * as React from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Markdown } from '@/app/components/base/markdown'
import { ChunkingMode } from '@/models/datasets'
type IAutoResizeTextAreaProps = Omit<TextareaProps, 'defaultValue' | 'onValueChange' | 'value'> & {
  value: string
  onValueChange: (value: string) => void
  containerRef: React.RefObject<HTMLDivElement | null>
  labelRef: React.RefObject<HTMLDivElement | null>
}

const AutoResizeTextArea: FC<IAutoResizeTextAreaProps> = React.memo(
  ({ className, placeholder, value, onValueChange, disabled, containerRef, labelRef, ...rest }) => {
    const textareaRef = useRef<HTMLTextAreaElement>(null)
    const observerRef = useRef<ResizeObserver>(null)
    const [maxHeight, setMaxHeight] = useState(0)

    useEffect(() => {
      const textarea = textareaRef.current
      if (!textarea) return
      textarea.style.height = 'auto'
      const lineHeight = Number.parseInt(getComputedStyle(textarea).lineHeight)
      const textareaHeight = Math.max(textarea.scrollHeight, lineHeight)
      textarea.style.height = `${textareaHeight}px`
    }, [value])

    useEffect(() => {
      const container = containerRef.current
      const label = labelRef.current
      if (!container || !label) return
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
      <Textarea
        ref={textareaRef}
        className={cn(
          'min-h-0 resize-none rounded-none border-none bg-transparent p-0 hover:border-none hover:bg-transparent focus:border-none focus:bg-transparent focus:shadow-none focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:ring-inset disabled:bg-transparent disabled:text-text-secondary disabled:hover:bg-transparent',
          className,
        )}
        style={{
          maxHeight,
        }}
        placeholder={placeholder}
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        {...rest}
      />
    )
  },
)

AutoResizeTextArea.displayName = 'AutoResizeTextArea'

type IQATextAreaProps = {
  question: string
  answer?: string
  onQuestionChange: (question: string) => void
  onAnswerChange?: (answer: string) => void
  isEditMode?: boolean
}

const QATextArea: FC<IQATextAreaProps> = React.memo(
  ({ question, answer, onQuestionChange, onAnswerChange, isEditMode = true }) => {
    const { t } = useTranslation(['datasetDocuments'])
    const containerRef = useRef<HTMLDivElement>(null)
    const labelRef = useRef<HTMLDivElement>(null)
    const questionLabelId = React.useId()
    const answerLabelId = React.useId()

    return (
      <div ref={containerRef} className="h-full overflow-hidden">
        <div
          id={questionLabelId}
          ref={labelRef}
          className="mb-1 text-xs font-medium text-text-tertiary"
        >
          QUESTION
        </div>
        <AutoResizeTextArea
          className="text-sm tracking-[-0.07px] text-text-secondary caret-[#295EFF]"
          value={question}
          aria-labelledby={questionLabelId}
          placeholder={t(($) => $['segment.questionPlaceholder'], { ns: 'datasetDocuments' }) || ''}
          onValueChange={(value) => onQuestionChange(value)}
          disabled={!isEditMode}
          containerRef={containerRef}
          labelRef={labelRef}
        />
        <div id={answerLabelId} className="mt-6 mb-1 text-xs font-medium text-text-tertiary">
          ANSWER
        </div>
        <AutoResizeTextArea
          className="text-sm tracking-[-0.07px] text-text-secondary caret-[#295EFF]"
          value={answer ?? ''}
          aria-labelledby={answerLabelId}
          placeholder={t(($) => $['segment.answerPlaceholder'], { ns: 'datasetDocuments' }) || ''}
          onValueChange={(value) => onAnswerChange?.(value)}
          disabled={!isEditMode}
          autoFocus
          containerRef={containerRef}
          labelRef={labelRef}
        />
      </div>
    )
  },
)

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
  const { t } = useTranslation(['datasetDocuments'])

  if (docForm === ChunkingMode.qa) {
    return (
      <QATextArea
        question={question}
        answer={answer}
        onQuestionChange={onQuestionChange}
        onAnswerChange={onAnswerChange}
        isEditMode={isEditMode}
      />
    )
  }

  if (!isEditMode) {
    return (
      <Markdown
        className="size-full text-text-secondary!"
        content={question}
        customDisallowedElements={['input']}
      />
    )
  }

  return (
    <Textarea
      className="h-full min-h-0 w-full resize-none rounded-none border-none bg-transparent p-0 pb-6 body-md-regular tracking-[-0.07px] text-text-secondary caret-[#295EFF] hover:border-none hover:bg-transparent focus:border-none focus:bg-transparent focus:shadow-none focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:ring-inset disabled:bg-transparent disabled:text-text-secondary disabled:hover:bg-transparent"
      value={question}
      aria-label={t(($) => $['segment.contentPlaceholder'], { ns: 'datasetDocuments' }) || ''}
      placeholder={t(($) => $['segment.contentPlaceholder'], { ns: 'datasetDocuments' }) || ''}
      onValueChange={(value) => onQuestionChange(value)}
      disabled={!isEditMode}
      autoFocus
    />
  )
}

ChunkContent.displayName = 'ChunkContent'

export default React.memo(ChunkContent)
