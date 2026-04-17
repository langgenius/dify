import { cn } from '@langgenius/dify-ui/cn'
import { useChatContext } from '@/app/components/base/chat/chat/context'
import { Button } from '@/app/components/base/ui/button'
import { isValidUrl } from './utils'

const MarkdownButton = ({ node }: any) => {
  const { onSend } = useChatContext()
  const variant = node.properties.dataVariant
  const message = node.properties.dataMessage
  const link = node.properties.dataLink
  const size = node.properties.dataSize

  return (
    <Button
      variant={variant}
      size={size}
      className={cn('h-auto! min-h-8 px-3! whitespace-normal select-none')}
      onClick={() => {
        if (link && isValidUrl(link)) {
          window.open(link, '_blank')
          return
        }
        if (!message)
          return
        onSend?.(message)
      }}
    >
      <span className="text-[13px]">{node.children[0]?.value || ''}</span>
    </Button>
  )
}
MarkdownButton.displayName = 'MarkdownButton'

export default MarkdownButton
