import { useChatContext } from '@/app/components/base/chat/chat/context'
import Button from '@/app/components/base/button'
import cn from '@/utils/classnames'

const MarkdownButton = ({ node }: any) => {
  const { onSend } = useChatContext()
  const variant = node.properties.dataVariant
  const message = node.properties.dataMessage
  const size = node.properties.dataSize

  return <Button
    variant={variant}
    size={size}
    className={cn('!h-8 !px-3 select-none')}
    onClick={() => onSend?.(message)}
  >
    <span className='text-[13px]'>{node.children[0]?.value || ''}</span>
  </Button>
}
MarkdownButton.displayName = 'MarkdownButton'

export default MarkdownButton
