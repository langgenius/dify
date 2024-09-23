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
import WorkflowProcess from './workflow-process'
import { AnswerTriangle } from '@/app/components/base/icons/src/vender/solid/general'
import LoadingAnim from '@/app/components/base/chat/chat/loading-anim'
import Citation from '@/app/components/base/chat/chat/citation'
import { EditTitle } from '@/app/components/app/annotation/edit-annotation-modal/edit-item'
import type { Emoji } from '@/app/components/tools/types'
import type { AppData } from '@/models/share'
import AnswerIcon from '@/app/components/base/answer-icon'
import cn from '@/utils/classnames'

type AnswerProps = {
  item: ChatItem
  question: string
  index: number
  config?: ChatConfig
  answerIcon?: ReactNode
  responding?: boolean
  allToolIcons?: Record<string, string | Emoji>
  showPromptLog?: boolean
  chatAnswerContainerInner?: string
  hideProcessDetail?: boolean
  appData?: AppData
  noChatInput?: boolean
}
const Answer: FC<AnswerProps> = ({
  item,
  question,
  index,
  config,
  answerIcon,
  responding,
  allToolIcons,
  showPromptLog,
  chatAnswerContainerInner,
  hideProcessDetail,
  appData,
  noChatInput,
}) => {
  const { t } = useTranslation()
  const {
    content,
    citation,
    agent_thoughts,
    more,
    annotation,
    workflowProcess,
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

  return (
    <div className='flex mb-2 last:mb-0'>
      <div className='shrink-0 relative w-10 h-10'>
        {answerIcon || <AnswerIcon />}
        {responding && (
          <div className='absolute -top-[3px] -left-[3px] pl-[6px] flex items-center w-4 h-4 bg-white rounded-full shadow-xs border-[0.5px] border-gray-50'>
            <LoadingAnim type='avatar' />
          </div>
        )}
      </div>
      <div className='chat-answer-container group grow w-0 ml-4' ref={containerRef}>
        <div className={cn('group relative pr-10', chatAnswerContainerInner)}>
          <AnswerTriangle className='absolute -left-2 top-0 w-2 h-3 text-gray-100' />
          <div
            ref={contentRef}
            className={cn('relative inline-block px-4 py-3 max-w-full bg-gray-100 rounded-b-2xl rounded-tr-2xl text-sm text-gray-900', workflowProcess && 'w-full')}
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
                <WorkflowProcess
                  data={workflowProcess}
                  item={item}
                  hideInfo
                  hideProcessDetail={hideProcessDetail}
                />
              )
            }
            {/** Hide workflow steps by it's settings in siteInfo */}
            {
              workflowProcess && hideProcessDetail && appData && appData.site.show_workflow_steps && (
                <WorkflowProcess
                  data={workflowProcess}
                  item={item}
                  hideInfo
                  hideProcessDetail={hideProcessDetail}
                />
              )
            }
            {
              responding && !content && !hasAgentThoughts && (
                <div className='flex items-center justify-center w-6 h-5'>
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
              hasAgentThoughts && (
                <AgentContent
                  item={item}
                  responding={responding}
                  allToolIcons={allToolIcons}
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
          </div>
        </div>
        <More more={more} />
      </div>
    </div>
  )
}

export default memo(Answer)
