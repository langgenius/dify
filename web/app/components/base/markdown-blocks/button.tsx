import type { ComponentProps } from 'react'
import type { ExtraProps } from 'streamdown'
import { Button, buttonVariants } from '@langgenius/dify-ui/button'
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
  const validLink = link && isValidUrl(link) ? link : undefined

  const className = 'h-auto! min-h-8 px-3! whitespace-normal select-none'

  if (validLink) {
    return (
      <a
        href={validLink}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(buttonVariants(appearance), className)}
      >
        <span className="text-[13px]">{label}</span>
      </a>
    )
  }

  return (
    <Button
      {...appearance}
      className={className}
      onClick={() => {
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
