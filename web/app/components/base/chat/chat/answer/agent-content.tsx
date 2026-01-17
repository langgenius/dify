import type { FC } from 'react'
import type {
  ChatItem,
} from '../../types'
import { memo } from 'react'
import Thought from '@/app/components/base/chat/chat/thought'
import { FileList } from '@/app/components/base/file-uploader'
import { getProcessedFilesFromResponse } from '@/app/components/base/file-uploader/utils'
import { Markdown } from '@/app/components/base/markdown'

type AgentContentProps = {
  item: ChatItem
  responding?: boolean
  content?: string
}
const AgentContent: FC<AgentContentProps> = ({
  item,
  responding,
  content,
}) => {
  const {
    annotation,
    agent_thoughts,
  } = item

  if (annotation?.logAnnotation)
    return <Markdown content={annotation?.logAnnotation.content || ''} />

  return (
    <div>
      {content ? <Markdown content={content} /> : agent_thoughts?.map((thought, index) => (
        <div key={index} className="px-2 py-1">
          {thought.thought && (
            <Markdown content={thought.thought} />
          )}
          {/* {item.tool} */}
          {/* perhaps not use tool */}
          {!!thought.tool && (
            <Thought
              thought={thought}
              isFinished={!!thought.observation || !responding}
            />
          )}

          {
            !!thought.message_files?.length && (
              <FileList
                files={getProcessedFilesFromResponse(thought.message_files.map((item: any) => ({ ...item, related_id: item.id })))}
                showDeleteAction={false}
                showDownloadAction={true}
                canPreview={true}
              />
            )
          }
        </div>
      ))}
    </div>
  )
}

export default memo(AgentContent)
