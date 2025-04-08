import type {
  FC,
  ReactNode,
} from 'react'
import { memo, useEffect, useRef, useState } from 'react'
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
import { ChevronRight } from '@/app/components/base/icons/src/vender/line/arrows'
import cn from '@/utils/classnames'
import { FileList } from '@/app/components/base/file-uploader'

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

  return (
    <div className='mb-2 flex last:mb-0'>
      <div className='relative h-10 w-10 shrink-0'>
        {answerIcon || <AnswerIcon />}
        {responding && (
          <div className='absolute -left-[3px] -top-[3px] flex h-4 w-4 items-center rounded-full border-[0.5px] border-divider-subtle bg-background-section-burn pl-[6px] shadow-xs'>
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
            {/** Render the normal steps */}
            {
              workflowProcess && !hideProcessDetail && (
                <WorkflowProcessItem
                  data={workflowProcess}
                  item={item}
                  hideProcessDetail={hideProcessDetail}
                />
              )
            }
            {/** Hide workflow steps by it's settings in siteInfo */}
            {
              workflowProcess && hideProcessDetail && appData && (
                <WorkflowProcessItem
                  data={workflowProcess}
                  item={item}
                  hideProcessDetail={hideProcessDetail}
                  readonly={!appData.site.show_workflow_steps}
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
            <SuggestedQuestions item={item} />
            {
              !!citation?.length && !responding && (
                <Citation data={citation} showHitInfo={config?.supportCitationHitInfo} />
              )
            }
            {item.siblingCount && item.siblingCount > 1 && item.siblingIndex !== undefined && <div className="flex items-center justify-center pt-3.5 text-sm">
              <button
                className={`${item.prevSibling ? 'opacity-100' : 'opacity-30'}`}
                disabled={!item.prevSibling}
                onClick={() => item.prevSibling && switchSibling?.(item.prevSibling)}
              >
                <ChevronRight className="h-[14px] w-[14px] rotate-180 text-text-primary" />
              </button>
              <span className="px-2 text-xs text-text-primary">{item.siblingIndex + 1} / {item.siblingCount}</span>
              <button
                className={`${item.nextSibling ? 'opacity-100' : 'opacity-30'}`}
                disabled={!item.nextSibling}
                onClick={() => item.nextSibling && switchSibling?.(item.nextSibling)}
              >
                <ChevronRight className="h-[14px] w-[14px] text-text-primary" />
              </button>
            </div>}
          </div>
        </div>
        <More more={more} />
      </div>
    </div>
  )
}

export default memo(Answer)
