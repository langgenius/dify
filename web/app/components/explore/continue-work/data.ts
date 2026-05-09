import { AppModeEnum } from '@/types/app'

export type ContinueWorkItem = {
  id: string
  title: string
  author: string
  updatedAt: number
  emoji: string
  avatarClassName: string
  mode: AppModeEnum
}

const currentTime = Date.now()

export const continueWorkItems: ContinueWorkItem[] = [
  {
    id: 'automated-email-reply',
    title: 'Automated Email Reply',
    author: 'Evan',
    updatedAt: currentTime - 30 * 1000,
    emoji: '🕹️',
    avatarClassName: 'bg-components-icon-bg-pink-soft',
    mode: AppModeEnum.CHAT,
  },
  {
    id: 'feature-request-copilot',
    title: 'Dify Feature Request Copilot',
    author: 'Evan',
    updatedAt: currentTime - 3 * 60 * 1000,
    emoji: '🪼',
    avatarClassName: 'bg-components-icon-bg-blue-soft',
    mode: AppModeEnum.CHAT,
  },
  {
    id: 'book-translation',
    title: 'Book Translation',
    author: 'Evan',
    updatedAt: currentTime - 2 * 60 * 60 * 1000,
    emoji: '📙',
    avatarClassName: 'bg-components-icon-bg-orange-dark-soft',
    mode: AppModeEnum.WORKFLOW,
  },
  {
    id: 'svg-logo-design',
    title: 'SVG Logo Design',
    author: 'Evan',
    updatedAt: currentTime - 24 * 60 * 60 * 1000,
    emoji: '🖌️',
    avatarClassName: 'bg-components-icon-bg-indigo-soft',
    mode: AppModeEnum.AGENT_CHAT,
  },
  {
    id: 'customer-feedback-summary',
    title: 'Customer Feedback Summary',
    author: 'Evan',
    updatedAt: currentTime - 5 * 24 * 60 * 60 * 1000,
    emoji: '📊',
    avatarClassName: 'bg-components-icon-bg-teal-soft',
    mode: AppModeEnum.COMPLETION,
  },
]
