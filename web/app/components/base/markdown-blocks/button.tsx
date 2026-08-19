import type { ComponentProps } from 'react'
import type { ExtraProps } from 'streamdown'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { useChatContext } from '@/app/components/base/chat/chat/context'
import { getMarkdownButtonAppearance } from './button-appearance'
import { isValidUrl } from './utils'

type MarkdownButtonProps = ComponentProps<'button'> & ExtraProps

function getStringProperty(value: unknown) {
  return typeof value === 'string' ? value : undefined
}

const MarkdownButton = ({ node }: MarkdownButtonProps) => {
  const { onSend } = useChatContext()
  const appearance = getMarkdownButtonAppearance(
    node?.properties.dataVariant,
    node?.properties.dataSize,
  )
  const message = getStringProperty(node?.properties.dataMessage)
  const link = getStringProperty(node?.properties.dataLink)
  const firstChild = node?.children[0]
  const label = firstChild?.type === 'text' ? firstChild.value : ''

  return (
    <Button
      {...appearance}
      className={cn('h-auto! min-h-8 px-3! whitespace-normal select-none')}
      onClick={() => {
        if (link && isValidUrl(link)) {
          window.open(link, '_blank')
          return
        }
        if (!message) return
        onSend?.(message)
      }}
    >
      <span className="text-[13px]">{label}</span>
    </Button>
  )
}
MarkdownButton.displayName = 'MarkdownButton'

export default MarkdownButton
