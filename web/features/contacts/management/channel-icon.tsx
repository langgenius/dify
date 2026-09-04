import { cn } from '@langgenius/dify-ui/cn'
import DingTalkIcon from './assets/dingtalk.svg'
import EmailIcon from './assets/email.svg'
import FeishuIcon from './assets/feishu.svg'
import SlackIcon from './assets/slack.svg'

export function ContactChannelIcon({
  className,
  provider,
}: {
  className?: string
  provider: string
}) {
  const normalizedProvider = provider.toLocaleLowerCase()

  const icon = {
    dingtalk: DingTalkIcon,
    email: EmailIcon,
    feishu: FeishuIcon,
    slack: SlackIcon,
  }[normalizedProvider]

  if (icon) {
    return (
      <img
        alt=""
        aria-hidden
        className={cn(
          'block shrink-0',
          normalizedProvider === 'email' ? 'size-4' : 'size-5',
          className,
        )}
        src={icon.src}
      />
    )
  }

  return (
    <span
      aria-hidden
      className={cn('i-ri-chat-3-line block size-4 text-text-tertiary', className)}
    />
  )
}
