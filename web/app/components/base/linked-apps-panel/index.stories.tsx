import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import type { RelatedApp } from '@/models/datasets'
import { AppModeEnum } from '@/types/app'
import LinkedAppsPanel from '.'

const mockRelatedApps: RelatedApp[] = [
  {
    id: 'app-cx',
    name: 'Customer Support Assistant',
    mode: AppModeEnum.CHAT,
    icon_type: 'emoji',
    icon: '\u{1F4AC}',
    icon_background: '#EEF2FF',
    icon_url: '',
  },
  {
    id: 'app-ops',
    name: 'Ops Workflow Orchestrator',
    mode: AppModeEnum.WORKFLOW,
    icon_type: 'emoji',
    icon: '\u{1F6E0}\u{FE0F}',
    icon_background: '#ECFDF3',
    icon_url: '',
  },
  {
    id: 'app-research',
    name: 'Research Synthesizer',
    mode: AppModeEnum.ADVANCED_CHAT,
    icon_type: 'emoji',
    icon: '\u{1F9E0}',
    icon_background: '#FDF2FA',
    icon_url: '',
  },
]

const meta = {
  title: 'Base/Feedback/LinkedAppsPanel',
  component: LinkedAppsPanel,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Shows a curated list of related applications, pairing each app icon with quick navigation links.',
      },
    },
  },
  args: {
    relatedApps: mockRelatedApps,
    isMobile: false,
  },
  argTypes: {
    isMobile: {
      control: 'boolean',
    },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof LinkedAppsPanel>

export default meta
type Story = StoryObj<typeof meta>

export const Desktop: Story = {}

export const Mobile: Story = {
  args: {
    isMobile: true,
  },
  parameters: {
    viewport: {
      defaultViewport: 'mobile2',
    },
  },
}
