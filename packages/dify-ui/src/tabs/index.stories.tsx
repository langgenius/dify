import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect } from 'storybook/test'
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
  play: async ({ canvas, userEvent }) => {
    const overviewTab = canvas.getByRole('tab', { name: 'Overview' })
    const activityTab = canvas.getByRole('tab', { name: 'Activity' })

    await expect(overviewTab).toHaveAttribute('aria-selected', 'true')
    await expect(canvas.getByRole('tabpanel', { name: 'Overview' })).toBeVisible()

    await userEvent.click(activityTab)

    await expect(activityTab).toHaveAttribute('aria-selected', 'true')
    await expect(canvas.getByRole('tabpanel', { name: 'Activity' })).toBeVisible()
  },
}
