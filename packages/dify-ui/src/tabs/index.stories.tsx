import type { Meta, StoryObj } from '@storybook/react-vite'
import {
  Tabs,
  TabsList,
  TabsPanel,
  TabsTab,
} from '.'

const meta = {
  title: 'Base/UI/Tabs',
  component: Tabs,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Composable tabs built on Base UI. Use this when a tab controls a corresponding tab panel.',
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
      <TabsList className="gap-4 border-b border-divider-subtle">
        <TabsTab
          value="overview"
          className="border-b border-transparent px-0 py-2 system-sm-medium text-text-tertiary data-active:border-text-accent data-active:text-text-primary"
        >
          Overview
        </TabsTab>
        <TabsTab
          value="activity"
          className="border-b border-transparent px-0 py-2 system-sm-medium text-text-tertiary data-active:border-text-accent data-active:text-text-primary"
        >
          Activity
        </TabsTab>
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
