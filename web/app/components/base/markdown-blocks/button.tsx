import { useChatContext } from '@/app/components/base/chat/chat/context'
import Button from '@/app/components/base/button'
import cn from '@/utils/classnames'

const MarkdownButton = ({ node }: any) => {
  const { onSend } = useChatContext()
  const variant = node.properties.dataVariant
  const message = node.properties.dataMessage
  const link = node.properties.dataLink
  const size = node.properties.dataSize

  function is_valid_url(url: string): boolean {
    try {
      const parsed_url = new URL(url)
      return ['http:', 'https:'].includes(parsed_url.protocol)
    }
    catch {
      return false
    }
  }

  return <Button
    variant={variant}
    size={size}
    className={cn('!h-8 !px-3 select-none')}
    onClick={() => {
      if (is_valid_url(link)) {
        window.open(link, '_blank')
        return
      }
      onSend?.(message)
    }}
  >
    <span className='text-[13px]'>{node.children[0]?.value || ''}</span>
  </Button>
}
MarkdownButton.displayName = 'MarkdownButton'

export default MarkdownButton
