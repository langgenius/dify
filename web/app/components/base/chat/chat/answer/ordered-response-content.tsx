import type { ReactNode } from 'react'
import type { ChatItem } from '../../types'
import { Fragment } from 'react'
import { useTranslation } from 'react-i18next'
import { GenerativeUIContent } from './generative-ui-content'

type OrderedResponseContentProps = {
  item: Pick<ChatItem, 'id' | 'parts'>
  content: string
  renderText: (content: string) => ReactNode
  allowInteractive?: boolean
}

/** Render ordered text and UI parts directly; fall back to plain content when parts are absent. */
export function OrderedResponseContent({
  item,
  content,
  renderText,
  allowInteractive = true,
}: OrderedResponseContentProps) {
  const { t } = useTranslation(['appDebug'])
  const parts = item.parts
  if (!parts?.length) return content ? <>{renderText(content)}</> : null

  return (
    <>
      {parts.map((part) =>
        part.type === 'text' ? (
          part.text ? (
            <Fragment key={part.id}>{renderText(part.text)}</Fragment>
          ) : null
        ) : (
          <GenerativeUIContent
            key={part.id}
            messageId={item.id}
            block={part}
            fallbackText={t(($) => $['generativeUI.unavailable'])}
            allowInteractive={allowInteractive}
          />
        ),
      )}
    </>
  )
}
