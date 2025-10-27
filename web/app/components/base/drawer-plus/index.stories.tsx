import type { Meta, StoryObj } from '@storybook/nextjs'
import { useState } from 'react'
import DrawerPlus from '.'

const meta = {
  title: 'Base/Feedback/DrawerPlus',
  component: DrawerPlus,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'Enhanced drawer built atop the base drawer component. Provides header/foot slots, mask control, and mobile breakpoints.',
      },
    },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof DrawerPlus>

export default meta
type Story = StoryObj<typeof meta>

const DrawerPlusDemo = (props: React.ComponentProps<typeof DrawerPlus>) => {
  const [open, setOpen] = useState(false)

  const defaultBody = (
    <div className="space-y-3 p-6 text-sm text-text-secondary">
      <p>
        DrawerPlus allows rich content with sticky header/footer and responsive masking on mobile. Great for editing flows or showing execution logs.
      </p>
      <div className="rounded-lg border border-divider-subtle bg-components-panel-bg p-3 text-xs">
        Body content scrolls if it exceeds the allotted height.
      </div>
    </div>
  )

  return (
    <div className="flex h-[400px] items-center justify-center bg-background-default-subtle">
      <button
        type="button"
        className="rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-primary-700"
        onClick={() => setOpen(true)}
      >
        Open drawer plus
      </button>

      <DrawerPlus
        {...props}
        isShow={open}
        onHide={() => setOpen(false)}
        title={props.title ?? 'Workflow execution details'}
        body={props.body ?? defaultBody}
        foot={props.foot}
      />
    </div>
  )
}

export const Playground: Story = {
  render: args => <DrawerPlusDemo {...args} />,
}

export const WithFooter: Story = {
  render: (args) => {
    const FooterDemo = () => {
      const [open, setOpen] = useState(false)
      return (
        <div className="flex h-[400px] items-center justify-center bg-background-default-subtle">
          <button
            type="button"
            className="rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-primary-700"
            onClick={() => setOpen(true)}
          >
            Open drawer plus
          </button>

          <DrawerPlus
            {...args}
            isShow={open}
            onHide={() => setOpen(false)}
            title={args.title ?? 'Workflow execution details'}
            body={args.body ?? (
              <div className="space-y-3 p-6 text-sm text-text-secondary">
                <p>Populate the body with scrollable content. Footer stays pinned.</p>
              </div>
            )}
            foot={
              <div className="flex justify-end gap-2 border-t border-divider-subtle bg-components-panel-bg p-4">
                <button className="rounded-md border border-divider-subtle px-3 py-1.5 text-sm text-text-secondary" onClick={() => setOpen(false)}>Cancel</button>
                <button className="rounded-md bg-primary-600 px-3 py-1.5 text-sm text-white">Save</button>
              </div>
            }
          />
        </div>
      )
    }
    return <FooterDemo />
  },
}
