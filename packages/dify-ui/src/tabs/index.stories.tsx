import type { Meta, StoryObj } from '@storybook/react-vite'
import { Tabs, TabsList, TabsPanel, TabsTab } from '.'

const meta = {
  title: 'Base/UI/Tabs',
  component: Tabs,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Composable tabs built on Base UI. Use this when a tab controls a corresponding tab panel.',
      },
    },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof Tabs>

export default meta
type Story = StoryObj<typeof meta>

export const Basic: Story = {
  render: () => (
    <Tabs defaultValue="overview" className="w-96">
      <TabsList>
        <TabsTab value="overview">Overview</TabsTab>
        <TabsTab value="activity">Activity</TabsTab>
      </TabsList>
      <TabsPanel value="overview" className="py-3 system-sm-regular text-text-secondary">
        Overview panel
      </TabsPanel>
      <TabsPanel value="activity" className="py-3 system-sm-regular text-text-secondary">
        Activity panel
      </TabsPanel>
    </Tabs>
  ),
}
