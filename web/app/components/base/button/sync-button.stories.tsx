import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import SyncButton from './sync-button'

const meta = {
  title: 'Base/General/SyncButton',
  component: SyncButton,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Icon-only refresh button that surfaces a tooltip and is used for manual sync actions across the UI.',
      },
    },
  },
  tags: ['autodocs'],
  argTypes: {
    className: {
      control: 'text',
      description: 'Additional classes appended to the clickable container.',
    },
    popupContent: {
      control: 'text',
      description: 'Tooltip text shown on hover.',
    },
    onClick: {
      control: false,
      description: 'Triggered when the sync button is pressed.',
    },
  },
  args: {
    popupContent: 'Sync now',
    onClick: () => console.log('Sync button clicked'),
  },
} satisfies Meta<typeof SyncButton>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {
    className: 'bg-white/80 shadow-sm backdrop-blur-sm',
  },
}

export const InHeader: Story = {
  render: args => (
    <div className="flex items-center gap-2 rounded-lg border border-divider-subtle bg-components-panel-bg p-3">
      <span className="text-xs text-text-tertiary">Logs</span>
      <div className="ml-auto flex items-center gap-2">
        <SyncButton {...args} />
      </div>
    </div>
  ),
  args: {
    popupContent: 'Refresh logs',
  },
}
