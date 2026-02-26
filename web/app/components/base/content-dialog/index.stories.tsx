import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { useEffect, useState } from 'react'
import ContentDialog from '.'

type Props = React.ComponentProps<typeof ContentDialog>

const meta = {
  title: 'Base/Feedback/ContentDialog',
  component: ContentDialog,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'Sliding panel overlay used in the app detail view. Includes dimmed backdrop and animated entrance/exit transitions.',
      },
    },
  },
  tags: ['autodocs'],
  argTypes: {
    className: {
      control: 'text',
      description: 'Additional classes applied to the sliding panel container.',
    },
    show: {
      control: 'boolean',
      description: 'Controls visibility of the dialog.',
    },
    onClose: {
      control: false,
      description: 'Invoked when the overlay/backdrop is clicked.',
    },
    children: {
      control: false,
      table: { disable: true },
    },
  },
  args: {
    show: false,
    children: null,
  },
} satisfies Meta<typeof ContentDialog>

export default meta
type Story = StoryObj<typeof meta>

const DemoWrapper = (props: Props) => {
  const [open, setOpen] = useState(props.show)

  useEffect(() => {
    setOpen(props.show)
  }, [props.show])

  return (
    <div className="relative h-[480px] w-full overflow-hidden bg-gray-100">
      <div className="flex h-full items-center justify-center">
        <button
          className="rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-primary-700"
          onClick={() => setOpen(true)}
        >
          Open dialog
        </button>
      </div>

      <ContentDialog
        {...props}
        show={open}
        onClose={() => {
          props.onClose?.()
          setOpen(false)
        }}
      >
        <div className="flex h-full flex-col space-y-4 bg-white p-6">
          <h2 className="text-lg font-semibold text-gray-900">Plan summary</h2>
          <p className="text-sm text-gray-600">
            Use this area to present rich content for the selected run, configuration details, or
            any supporting context.
          </p>
          <div className="flex-1 overflow-y-auto rounded-md border border-dashed border-gray-200 bg-gray-50 p-4 text-xs text-gray-500">
            Scrollable placeholder content. Add domain-specific information, activity logs, or
            editors in the real application.
          </div>
          <div className="flex justify-end gap-2 pt-4">
            <button
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
              onClick={() => setOpen(false)}
            >
              Cancel
            </button>
            <button className="rounded-md bg-primary-600 px-3 py-1.5 text-sm text-white hover:bg-primary-700">
              Apply changes
            </button>
          </div>
        </div>
      </ContentDialog>
    </div>
  )
}

export const Default: Story = {
  args: {
    children: null,
  },
  render: args => <DemoWrapper {...args} />,
}

export const NarrowPanel: Story = {
  render: args => <DemoWrapper {...args} />,
  args: {
    className: 'max-w-[420px]',
    children: null,
  },
  parameters: {
    docs: {
      description: {
        story: 'Applies a custom width class to show the dialog as a narrower information panel.',
      },
    },
  },
}
