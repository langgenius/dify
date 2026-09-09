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
    ding_talk: DingTalkIcon,
    dingtalk: DingTalkIcon,
    email: EmailIcon,
    feishu: FeishuIcon,
    lark: FeishuIcon,
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

  if (normalizedProvider === 'ms_teams' || normalizedProvider === 'teams') {
    return (
      <span
        aria-hidden
        className={cn('i-custom-public-other-teams block size-5 shrink-0', className)}
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
