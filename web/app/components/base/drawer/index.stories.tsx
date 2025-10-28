import type { Meta, StoryObj } from '@storybook/nextjs'
import { fn } from 'storybook/test'
import { useState } from 'react'
import Drawer from '.'

const meta = {
  title: 'Base/Feedback/Drawer',
  component: Drawer,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'Sliding panel built on Headless UI dialog primitives. Supports optional mask, custom footer, and close behaviour.',
      },
    },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof Drawer>

export default meta
type Story = StoryObj<typeof meta>

const DrawerDemo = (props: React.ComponentProps<typeof Drawer>) => {
  const [open, setOpen] = useState(false)

  return (
    <div className="flex h-[400px] items-center justify-center bg-background-default-subtle">
      <button
        type="button"
        className="rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-primary-700"
        onClick={() => setOpen(true)}
      >
        Open drawer
      </button>

      <Drawer
        {...props}
        isOpen={open}
        onClose={() => setOpen(false)}
        title={props.title ?? 'Edit configuration'}
        description={props.description ?? 'Adjust settings in the side panel and save.'}
        footer={props.footer ?? undefined}
      >
        <div className="mt-4 space-y-3 text-sm text-text-secondary">
          <p>
            This example renders arbitrary content inside the drawer body. Use it for contextual forms, settings, or informational panels.
          </p>
          <div className="rounded-lg border border-divider-subtle bg-components-panel-bg p-3 text-xs">
            Content area
          </div>
        </div>
      </Drawer>
    </div>
  )
}

export const Playground: Story = {
  render: args => <DrawerDemo {...args} />,
  args: {
    children: null,
    isOpen: false,
    onClose: fn(),
  },
  parameters: {
    docs: {
      source: {
        language: 'tsx',
        code: `
const [open, setOpen] = useState(false)

<Drawer
  isOpen={open}
  onClose={() => setOpen(false)}
  title="Edit configuration"
  description="Adjust settings in the side panel and save."
>
  ...
</Drawer>
        `.trim(),
      },
    },
  },
}

export const CustomFooter: Story = {
  render: args => (
    <DrawerDemo
      {...args}
      footer={
        <div className="mt-6 flex justify-end gap-2">
          <button className="rounded-md border border-divider-subtle px-3 py-1.5 text-sm text-text-secondary" onClick={() => args.onCancel?.()}>Discard</button>
          <button className="rounded-md bg-primary-600 px-3 py-1.5 text-sm text-white">Save changes</button>
        </div>
      }
    />
  ),
  args: {
    children: null,
    isOpen: false,
    onClose: fn(),
  },
  parameters: {
    docs: {
      source: {
        language: 'tsx',
        code: `
<Drawer footer={<CustomFooter />}>
  ...
</Drawer>
        `.trim(),
      },
    },
  },
}
