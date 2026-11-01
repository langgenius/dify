import { cn } from '@langgenius/dify-ui/cn'
import DingTalkIcon from './assets/dingtalk.svg'
import EmailIcon from './assets/email.svg'
import FeishuIcon from './assets/feishu.svg'
import SlackIcon from './assets/slack.svg'

// Original WeCom brand mark from work.weixin.qq.com, embedded to keep the asset local.
const weComIcon =
  'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMSIgaGVpZ2h0PSIyNiIgdmlld0JveD0iMCAwIDMxIDI2Ij48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxwYXRoIGZpbGw9IiMwMDgyRjAiIGQ9Ik0yNC4yNyA2LjlhMTAuNzQ2IDEwLjc0NiAwIDAwLTEuOTQ1LTIuNzY0QzIwLjI5NSAyLjAzNCAxNy40NTMuNjggMTQuMzIyLjMyM2ExNC43NzMgMTQuNzczIDAgMDAtMS42NTYtLjA5NmMtLjUxMSAwLTEuMDQ0LjAzLTEuNTg1LjA4OS0zLjE0NC4zNDItNi4wMDIgMS42OS04LjA0NyAzLjc5MmExMC43NTcgMTAuNzU3IDAgMDAtMS45NTUgMi43NTcgOS42MzQgOS42MzQgMCAwMC0xLjAwMyA0LjI3N2MwIDEuOTA5LjU4IDMuNzkgMS42NzggNS40NDJhMTQuOTYgMTQuOTYgMCAwMDIuMzAyIDIuNjM0di4wMDJsLS4zNzggMi45NzRjLS4wMTUuMDQtLjAzMS4wOC0uMDQuMTIzLS4wMS4wMzktLjAxMi4wNzktLjAxNi4xMTktLjAwMi4wMy0uMDEuMDYtLjAxLjA5MSAwIC4wMzMuMDA4LjA2NS4wMS4wOTguMDUuNDg5LjQ1OC44NzIuOTYuODcyLjE3NSAwIC4zMzctLjA1LjQ3OC0uMTMxbC4wMTQtLjAwOGMuMDItLjAxMi4wNDItLjAyMy4wNjItLjAzNmwuOTAzLS40NTQgMi42OS0xLjM1MmExMy45MyAxMy45MyAwIDAwMi4zNS40NTMgMTQuNTQgMTQuNTQgMCAwMDMuMjQzLS4wMDkgMTQuMDkyIDE0LjA5MiAwIDAwMy4xNzMtLjc0MiAxLjc1MiAxLjc1MiAwIDAxLTEuMTkyLTEuODMyYy0uNzIuMjMtMS40NzIuMzkzLTIuMjUuNDgyYTEyLjE3MiAxMi4xNzIgMCAwMS0yLjcxNi4wMDhjLS4wOS0uMDEtLjE4Mi0uMDI1LS4yNzQtLjAzN2ExMS45NzYgMTEuOTc2IDAgMDEtMS43OC0uMzczIDEuMjE3IDEuMjE3IDAgMDAtLjM3LS4wNTdjLS4yIDAtLjM5Mi4wNTMtLjU4OC4xNTQtLjAyNi4wMTQtLjA1LjAyNS0uMDc2LjA0bC0yLjIxIDEuMzAzLS4wOTYuMDU3LS4wMDMuMDAxYy0uMDQ3LjAyOC0uMDc1LjAzOS0uMS4wMzlhLjE1LjE1IDAgMDEtLjE0Ni0uMTUzbC4wODUtLjM0NS4wOTgtLjM3NS4xNjItLjYxNC4xNzktLjY4NmEuOTMuOTMgMCAwMC0uMzM0LTEuMDMzIDkuOTA2IDkuOTA2IDAgMDEtLjkyMy0uNzc3Yy0uNS0uNDc1LS45NC0uOTk0LTEuMzEtMS41NS0uODY5LTEuMzA4LTEuMzI4LTIuNzkyLTEuMzI4LTQuMjkzIDAtMS4xNjQuMjY2LTIuMjk3Ljc5LTMuMzY2YTguNjMzIDguNjMzIDAgMDExLjU2OS0yLjIxYzEuNjgtMS43MjggNC4wNDUtMi44MzcgNi42NTYtMy4xMi40NTQtLjA1LjkwMS0uMDc1IDEuMzI4LS4wNzUuNDQ5IDAgLjkxNi4wMjcgMS4zODguMDggMi41OTkuMjk2IDQuOTQ5IDEuNDEgNi42MTcgMy4xMzhhOC42MTggOC42MTggMCAwMTEuNTYgMi4yMTUgNy41ODQgNy41ODQgMCAwMS43NzggMy4zMzhjMCAuMTItLjAwNy4yNC0uMDEzLjM2YTEuNzQ2IDEuNzQ2IDAgMDEyLjE0OS4yNTFjLjAzLjAzLjA1NC4wNjIuMDguMDkzYTkuMTEgOS4xMSAwIDAwLjAzMS0uNzM5IDkuNjM0IDkuNjM0IDAgMDAtLjk4Ni00LjI0MyIgLz48cGF0aCBmaWxsPSIjRkI2NTAwIiBkPSJNMjQuMTQ5IDIyLjE0OGExLjcgMS43IDAgMDAtLjIxLS4wMzUgNS4zNzcgNS4zNzcgMCAwMS0yLjk5Ni0xLjY3di4wMDFhLjQxOC40MTggMCAxMC0uNTM0LjY0Yy4wNDEuMDQuMDgyLjA3OC4xMjEuMTE4YTUuMzkgNS4zOSAwIDAxMS40NzggMi43NjEgMS43MTUgMS43MTUgMCAwMC4wNTkuMzU2IDEuNzQ5IDEuNzQ5IDAgMDAyLjkyNi43NzcgMS43NTQgMS43NTQgMCAwMC0uODQ0LTIuOTQ4IiAvPjxwYXRoIGZpbGw9IiMwMDgyRjAiIGQ9Ik0yOS45NDQgMTcuNjczYTEuNzUgMS43NSAwIDAwLTIuOTggMS4wNTYgNS4zODggNS4zODggMCAwMS0xLjY2NyAyLjk5OS40MTkuNDE5IDAgMTAuNjQxLjUzNGwuMTE3LS4xMjFhNS4zNzYgNS4zNzYgMCAwMTIuNzU4LTEuNDggMS43MSAxLjcxIDAgMDAuMzU1LS4wNTggMS43NTQgMS43NTQgMCAwMC43NzYtMi45MyIgLz48cGF0aCBmaWxsPSIjMkRCQzAwIiBkPSJNMjIuNTMgMTIuNzE3YTEuNzU0IDEuNzU0IDAgMDAxLjA1NCAyLjk4MiA1LjM3NiA1LjM3NiAwIDAxMi45OTYgMS42Ny40MTkuNDE5IDAgMTAuNTM0LS42NDEgNS4zODkgNS4zODkgMCAwMS0xLjYtMi44NzkgMS42MjUgMS42MjUgMCAwMC0uMDU4LS4zNTUgMS43NSAxLjc1IDAgMDAtMi45MjYtLjc3NyIgLz48cGF0aCBmaWxsPSIjRkMwIiBkPSJNMjAuNTQzIDE5LjE5YTEuOTMgMS45MyAwIDAwLjAxNS0uMTA2IDUuMzkzIDUuMzkzIDAgMDExLjY2OC0zIC40Mi40MiAwIDEwLS42NC0uNTM0IDUuMzc1IDUuMzc1IDAgMDEtMi44NzYgMS42IDEuNzMgMS43MyAwIDAwLS4zNTUuMDYgMS43NTQgMS43NTQgMCAwMC0uNzc2IDIuOTMgMS43NSAxLjc1IDAgMDAyLjk2NC0uOTUiIC8+PC9nPjwvc3ZnPg=='

export function ContactChannelIcon({
  className,
  provider,
}: {
  className?: string
  provider: string
}) {
  const normalizedProvider = provider.toLocaleLowerCase()

  const icon = {
    ding_talk: DingTalkIcon.src,
    dingtalk: DingTalkIcon.src,
    email: EmailIcon.src,
    feishu: FeishuIcon.src,
    lark: FeishuIcon.src,
    slack: SlackIcon.src,
    we_com: weComIcon,
    wecom: weComIcon,
  }[normalizedProvider]

  if (icon) {
    return (
      <img
        alt=""
        aria-hidden
        className={cn(
          'block shrink-0 object-contain',
          normalizedProvider === 'email' ? 'size-4' : 'size-5',
          className,
        )}
        src={icon}
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
