import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import NotionConnector from '.'

const meta = {
  title: 'Base/Other/NotionConnector',
  component: NotionConnector,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Call-to-action card inviting users to connect a Notion workspace. Shows the product icon, copy, and primary button.',
      },
    },
  },
  args: {
    onSetting: () => {
      console.log('Open Notion settings')
    },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof NotionConnector>

export default meta
type Story = StoryObj<typeof meta>

export const Playground: Story = {}
