import type { ReactNode } from 'react'
import type { ChatItem } from '../../types'
import { Fragment } from 'react'
import { useTranslation } from 'react-i18next'
import { GenerativeUIContent } from './generative-ui-content'

type OrderedResponseContentProps = {
  item: Pick<ChatItem, 'id' | 'content_blocks'>
  content: string
  renderText: (content: string) => ReactNode
}

/** UI positions count Unicode code points, matching the producer's Python strings. */
export function OrderedResponseContent({ item, content, renderText }: OrderedResponseContentProps) {
  const { t } = useTranslation(['appDebug'])
  const characters = Array.from(content)
  const blocks = [...(item.content_blocks ?? [])].sort(
    (left, right) => left.text_offset - right.text_offset,
  )
  let offset = 0

  return (
    <>
      {blocks.map((block) => {
        const text = characters.slice(offset, block.text_offset).join('')
        offset = block.text_offset
        return (
          <Fragment key={block.id}>
            {text && renderText(text)}
            <GenerativeUIContent
              messageId={item.id}
              block={block}
              fallbackText={t(($) => $['generativeUI.unavailable'])}
            />
          </Fragment>
        )
      })}
      {offset < characters.length && renderText(characters.slice(offset).join(''))}
    </>
  )
}
