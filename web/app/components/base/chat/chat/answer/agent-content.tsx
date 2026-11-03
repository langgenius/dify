import type { FC } from 'react'
import type { ChatItem } from '../../types'
import type { FileEntity } from '@/app/components/base/file-uploader/types'
import type { FileResponse } from '@/types/workflow'
import { memo } from 'react'
import Thought from '@/app/components/base/chat/chat/thought'
import { FileList } from '@/app/components/base/file-uploader'
import { getProcessedFilesFromResponse } from '@/app/components/base/file-uploader/utils'
import { Markdown } from '@/app/components/base/markdown'
import { OrderedResponseContent } from './ordered-response-content'

type AgentContentProps = {
  item: ChatItem
  responding?: boolean
  content?: string
}
const AgentContent: FC<AgentContentProps> = ({ item, responding, content }) => {
  const { annotation, agent_thoughts } = item

  if (annotation?.logAnnotation) {
    return (
      <>
        <Markdown
          content={annotation?.logAnnotation.content || ''}
          data-testid="agent-content-markdown"
        />
        <OrderedResponseContent item={item} content="" renderText={() => null} />
      </>
    )
  }

  return (
    <div data-testid="agent-content-container">
      {content ? (
        <OrderedResponseContent
          item={item}
          content={content}
          renderText={(text) => <Markdown content={text} data-testid="agent-content-markdown" />}
        />
      ) : (
        agent_thoughts?.map((thought, index) => (
          <div key={index} className="px-2 py-1" data-testid="agent-thought-item">
            {thought.thought && (
              <Markdown content={thought.thought} data-testid="agent-thought-markdown" />
            )}
            {/* {item.tool} */}
            {/* perhaps not use tool */}
            {!!thought.tool && (
              <Thought thought={thought} isFinished={!!thought.observation || !responding} />
            )}

            {!!thought.message_files?.length && (
              <FileList
                files={thought.message_files.flatMap(
                  (file: FileEntity | (FileResponse & { id?: string })) =>
                    // Streaming files are normalized already; historical thoughts can carry API metadata.
                    'transferMethod' in file
                      ? [file]
                      : getProcessedFilesFromResponse([
                          { ...file, related_id: file.id ?? file.related_id },
                        ]),
                )}
                showDeleteAction={false}
                showDownloadAction={true}
                canPreview={true}
              />
            )}
          </div>
        ))
      )}
      {!content && <OrderedResponseContent item={item} content="" renderText={() => null} />}
    </div>
  )
}

export default memo(AgentContent)
