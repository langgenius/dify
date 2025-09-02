import type {
  FC,
  ReactNode,
} from 'react'
import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  ChatConfig,
  ChatItem,
} from '../../types'
import Operation from './operation'
import AgentContent from './agent-content'
import BasicContent from './basic-content'
import SuggestedQuestions from './suggested-questions'
import More from './more'
import WorkflowProcessItem from './workflow-process'
import LoadingAnim from '@/app/components/base/chat/chat/loading-anim'
import Citation from '@/app/components/base/chat/chat/citation'
import { EditTitle } from '@/app/components/app/annotation/edit-annotation-modal/edit-item'
import type { AppData } from '@/models/share'
import AnswerIcon from '@/app/components/base/answer-icon'
import cn from '@/utils/classnames'
import { FileList } from '@/app/components/base/file-uploader'
import ContentSwitch from '../content-switch'

const VoteDisplay: FC<{ feedback?: { rating: 'like' | 'dislike' | null } }> = ({ feedback }) => {
  const { t } = useTranslation()

  if (!feedback?.rating) return null

  return (
    <div className='mt-2 flex items-center gap-1 text-xs text-text-secondary'>
      <span className='mr-1'>{t('common.feedback.userVote')}</span>
      {feedback.rating === 'like' && (
        <div className='flex items-center gap-1 rounded-md bg-green-50 px-2 py-1 text-green-700'>
          <svg className='h-3 w-3' fill='currentColor' viewBox='0 0 20 20'>
            <path d='M2 10.5a1.5 1.5 0 113 0v6a1.5 1.5 0 01-3 0v-6zM6 10.333v5.43a2 2 0 001.106 1.79l.05.025A4 4 0 008.943 18h5.416a2 2 0 001.962-1.608l1.2-6A2 2 0 0015.56 8H12V4a2 2 0 00-2-2 1 1 0 00-1 1v.667a4 4 0 01-.8 2.4L6.8 7.933a4 4 0 00-.8 2.4z' />
          </svg>
        </div>
      )}
      {feedback.rating === 'dislike' && (
        <div className='flex items-center gap-1 rounded-md bg-red-50 px-2 py-1 text-red-700'>
          <svg className='h-3 w-3' fill='currentColor' viewBox='0 0 20 20'>
            <path d='M18 9.5a1.5 1.5 0 11-3 0v-6a1.5 1.5 0 013 0v6zM14 9.667v-5.43a2 2 0 00-1.105-1.79l-.05-.025A4 4 0 0011.055 2H5.64a2 2 0 00-1.962 1.608l-1.2 6A2 2 0 004.44 12H8v4a2 2 0 002 2 1 1 0 001-1v-.667a4 4 0 01.8-2.4l1.4-1.866a4 4 0 00.8-2.4z' />
          </svg>
        </div>
      )}
    </div>
  )
}

type AnswerProps = {
  item: ChatItem
  question: string
  index: number
  config?: ChatConfig
  answerIcon?: ReactNode
  responding?: boolean
  showPromptLog?: boolean
  chatAnswerContainerInner?: string
  hideProcessDetail?: boolean
  appData?: AppData
  noChatInput?: boolean
  switchSibling?: (siblingMessageId: string) => void
}
const Answer: FC<AnswerProps> = ({
  item,
  question,
  index,
  config,
  answerIcon,
  responding,
  showPromptLog,
  chatAnswerContainerInner,
  hideProcessDetail,
  appData,
  noChatInput,
  switchSibling,
}) => {
  const { t } = useTranslation()
  const {
    content,
    citation,
    agent_thoughts,
    more,
    annotation,
    workflowProcess,
    allFiles,
    message_files,
  } = item
  const hasAgentThoughts = !!agent_thoughts?.length

  const [containerWidth, setContainerWidth] = useState(0)
  const [contentWidth, setContentWidth] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  const getContainerWidth = () => {
    if (containerRef.current)
      setContainerWidth(containerRef.current?.clientWidth + 16)
  }
  useEffect(() => {
    getContainerWidth()
  }, [])

  const getContentWidth = () => {
    if (contentRef.current)
      setContentWidth(contentRef.current?.clientWidth)
  }

  useEffect(() => {
    if (!responding)
      getContentWidth()
  }, [responding])

  // Recalculate contentWidth when content changes (e.g., SVG preview/source toggle)
  useEffect(() => {
    if (!containerRef.current)
      return
    const resizeObserver = new ResizeObserver(() => {
      getContentWidth()
    })
    resizeObserver.observe(containerRef.current)
    return () => {
      resizeObserver.disconnect()
    }
  }, [])

  const handleSwitchSibling = useCallback((direction: 'prev' | 'next') => {
    if (direction === 'prev')
      item.prevSibling && switchSibling?.(item.prevSibling)
    else
      item.nextSibling && switchSibling?.(item.nextSibling)
  }, [switchSibling, item.prevSibling, item.nextSibling])

  return (
    <div className='mb-2 flex last:mb-0'>
      <div className='relative h-10 w-10 shrink-0'>
        {answerIcon || <AnswerIcon />}
        {responding && (
          <div className='absolute left-[-3px] top-[-3px] flex h-4 w-4 items-center rounded-full border-[0.5px] border-divider-subtle bg-background-section-burn pl-[6px] shadow-xs'>
            <LoadingAnim type='avatar' />
          </div>
        )}
      </div>
      <div className='chat-answer-container group ml-4 w-0 grow pb-4' ref={containerRef}>
        <div className={cn('group relative pr-10', chatAnswerContainerInner)}>
          <div
            ref={contentRef}
            className={cn('body-lg-regular relative inline-block max-w-full rounded-2xl bg-chat-bubble-bg px-4 py-3 text-text-primary', workflowProcess && 'w-full')}
          >
            {
              !responding && (
                <Operation
                  hasWorkflowProcess={!!workflowProcess}
                  maxSize={containerWidth - contentWidth - 4}
                  contentWidth={contentWidth}
                  item={item}
                  question={question}
                  index={index}
                  showPromptLog={showPromptLog}
                  noChatInput={noChatInput}
                />
              )
            }
            {/** Render workflow process */}
            {
              workflowProcess && (
                <WorkflowProcessItem
                  data={workflowProcess}
                  item={item}
                  hideProcessDetail={hideProcessDetail}
                  readonly={hideProcessDetail && appData ? !appData.site.show_workflow_steps : undefined}
                />
              )
            }
            {
              responding && !content && !hasAgentThoughts && (
                <div className='flex h-5 w-6 items-center justify-center'>
                  <LoadingAnim type='text' />
                </div>
              )
            }
            {
              content && !hasAgentThoughts && (
                <BasicContent item={item} />
              )
            }
            {
              (hasAgentThoughts) && (
                <AgentContent
                  item={item}
                  responding={responding}
                  content={content}
                />
              )
            }
            {
              !!allFiles?.length && (
                <FileList
                  className='my-1'
                  files={allFiles}
                  showDeleteAction={false}
                  showDownloadAction
                  canPreview
                />
              )
            }
            {
              !!message_files?.length && (
                <FileList
                  className='my-1'
                  files={message_files}
                  showDeleteAction={false}
                  showDownloadAction
                  canPreview
                />
              )
            }
            {
              annotation?.id && annotation.authorName && (
                <EditTitle
                  className='mt-1'
                  title={t('appAnnotation.editBy', { author: annotation.authorName })}
                />
              )
            }
            <VoteDisplay feedback={item.feedback} />
            <SuggestedQuestions item={item} />
            {
              !!citation?.length && !responding && (
                <Citation data={citation} showHitInfo={config?.supportCitationHitInfo} />
              )
            }
            {
              item.siblingCount && item.siblingCount > 1 && item.siblingIndex !== undefined && (
                <ContentSwitch
                  count={item.siblingCount}
                  currentIndex={item.siblingIndex}
                  prevDisabled={!item.prevSibling}
                  nextDisabled={!item.nextSibling}
                  switchSibling={handleSwitchSibling}
                />
              )
            }
          </div>
        </div>
        <More more={more} />
      </div>
    </div>
  )
}

export default memo(Answer)
