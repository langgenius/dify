import type { Meta, StoryObj } from '@storybook/nextjs'
import { useState } from 'react'
import FullScreenModal from '.'

const meta = {
  title: 'Base/Feedback/FullScreenModal',
  component: FullScreenModal,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'Backdrop-blurred fullscreen modal. Supports close button, custom content, and optional overflow visibility.',
      },
    },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof FullScreenModal>

export default meta
type Story = StoryObj<typeof meta>

const ModalDemo = (props: React.ComponentProps<typeof FullScreenModal>) => {
  const [open, setOpen] = useState(false)

  return (
    <div className="flex h-[360px] items-center justify-center bg-background-default-subtle">
      <button
        type="button"
        className="rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-primary-700"
        onClick={() => setOpen(true)}
      >
        Launch full-screen modal
      </button>

      <FullScreenModal
        {...props}
        open={open}
        onClose={() => setOpen(false)}
        closable
      >
        <div className="flex h-full flex-col bg-background-default-subtle">
          <div className="flex h-16 items-center justify-center border-b border-divider-subtle text-lg font-semibold text-text-primary">
            Full-screen experience
          </div>
          <div className="flex flex-1 items-center justify-center text-sm text-text-secondary">
            Place dashboards, flow builders, or immersive previews here.
          </div>
        </div>
      </FullScreenModal>
    </div>
  )
}

export const Playground: Story = {
  render: args => <ModalDemo {...args} />,
  args: {
    open: false,
  },
}
