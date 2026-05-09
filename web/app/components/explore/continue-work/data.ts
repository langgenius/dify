import type { AppIconType } from '@/types/app'
import { AppModeEnum } from '@/types/app'

export type ContinueWorkItem = {
  id: string
  title: string
  author: string
  updatedAt: number
  icon_type: AppIconType | null
  icon: string
  icon_background: string | null
  icon_url: string | null
  mode: AppModeEnum
}

const currentTime = Date.now()

export const continueWorkItems: ContinueWorkItem[] = [
  {
    id: 'automated-email-reply',
    title: 'Automated Email Reply',
    author: 'Evan',
    updatedAt: currentTime - 30 * 1000,
    icon_type: 'emoji',
    icon: '🕹️',
    icon_background: '#FDF2FA',
    icon_url: null,
    mode: AppModeEnum.CHAT,
  },
  {
    id: 'feature-request-copilot',
    title: 'Dify Feature Request Copilot',
    author: 'Evan',
    updatedAt: currentTime - 3 * 60 * 1000,
    icon_type: 'emoji',
    icon: '🪼',
    icon_background: '#EFF4FF',
    icon_url: null,
    mode: AppModeEnum.CHAT,
  },
  {
    id: 'book-translation',
    title: 'Book Translation',
    author: 'Evan',
    updatedAt: currentTime - 2 * 60 * 60 * 1000,
    icon_type: 'emoji',
    icon: '📙',
    icon_background: '#FFF4ED',
    icon_url: null,
    mode: AppModeEnum.WORKFLOW,
  },
  {
    id: 'svg-logo-design',
    title: 'SVG Logo Design',
    author: 'Evan',
    updatedAt: currentTime - 24 * 60 * 60 * 1000,
    icon_type: 'emoji',
    icon: '🖌️',
    icon_background: '#EEF4FF',
    icon_url: null,
    mode: AppModeEnum.AGENT_CHAT,
  },
  {
    id: 'customer-feedback-summary',
    title: 'Customer Feedback Summary',
    author: 'Evan',
    updatedAt: currentTime - 5 * 24 * 60 * 60 * 1000,
    icon_type: 'emoji',
    icon: '📊',
    icon_background: '#F0FDF9',
    icon_url: null,
    mode: AppModeEnum.COMPLETION,
  },
]
