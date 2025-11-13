import type { Meta, StoryObj } from '@storybook/nextjs'
import AddButton from './add-button'

const meta = {
  title: 'Base/General/AddButton',
  component: AddButton,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Compact icon-only button used for inline “add” actions in lists, cards, and modals.',
      },
    },
  },
  tags: ['autodocs'],
  argTypes: {
    className: {
      control: 'text',
      description: 'Extra classes appended to the clickable container.',
    },
    onClick: {
      control: false,
      description: 'Triggered when the add button is pressed.',
    },
  },
  args: {
    onClick: () => console.log('Add button clicked'),
  },
} satisfies Meta<typeof AddButton>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {
    className: 'bg-white/80 shadow-sm backdrop-blur-sm',
  },
}

export const InToolbar: Story = {
  render: args => (
    <div className="flex items-center gap-2 rounded-lg border border-divider-subtle bg-components-panel-bg p-3">
      <span className="text-xs text-text-tertiary">Attachments</span>
      <div className="ml-auto flex items-center gap-2">
        <AddButton {...args} />
      </div>
    </div>
  ),
  args: {
    className: 'border border-dashed border-primary-200',
  },
}
