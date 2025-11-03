import type { Meta, StoryObj } from '@storybook/nextjs'
import { fn } from 'storybook/test'
import { useState } from 'react'
import FloatRightContainer from '.'

const meta = {
  title: 'Base/Feedback/FloatRightContainer',
  component: FloatRightContainer,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'Wrapper that renders content in a drawer on mobile and inline on desktop. Useful for responsive settings panels.',
      },
    },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof FloatRightContainer>

export default meta
type Story = StoryObj<typeof meta>

const ContainerDemo = () => {
  const [open, setOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(false)

  return (
    <div className="flex h-[360px] flex-col gap-4 bg-background-default-subtle p-6">
      <div className="flex items-center gap-3">
        <button
          type="button"
          className="rounded-md bg-primary-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-primary-700"
          onClick={() => setOpen(true)}
        >
          Open panel
        </button>
        <label className="flex items-center gap-1 text-xs text-text-secondary">
          <input
            type="checkbox"
            checked={isMobile}
            onChange={e => setIsMobile(e.target.checked)}
          />
          Simulate mobile
        </label>
      </div>

      <FloatRightContainer
        isMobile={isMobile}
        isOpen={open}
        onClose={() => setOpen(false)}
        title="Responsive panel"
        description="Switch the toggle to see drawer vs inline behaviour."
        mask
      >
        <div className="rounded-xl border border-divider-subtle bg-components-panel-bg p-4 text-xs text-text-secondary">
          <p className="mb-2 text-sm text-text-primary">Panel Content</p>
          <p>
            On desktop, this block renders inline when `isOpen` is true. On mobile it appears inside the drawer wrapper.
          </p>
        </div>
      </FloatRightContainer>
    </div>
  )
}

export const Playground: Story = {
  render: () => <ContainerDemo />,
  args: {
    isMobile: false,
    isOpen: false,
    onClose: fn(),
    children: null,
  },
}
