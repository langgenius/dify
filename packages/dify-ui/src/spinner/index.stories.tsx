import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect } from 'storybook/test'
import { Spinner, SpinnerIcon } from '.'

const meta = {
  title: 'Base/UI/Spinner',
  component: Spinner,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  args: { 'aria-label': 'Loading agent details' },
} satisfies Meta<typeof Spinner>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  play: async ({ canvas }) => {
    const progress = canvas.getByRole('progressbar', { name: 'Loading agent details' })
    await expect(progress).not.toHaveAttribute('aria-valuenow')
    await expect(progress).not.toHaveAttribute('aria-valuetext')
  },
}

export const VisibleLabel: Story = {
  render: () => (
    <div className="flex items-center gap-2">
      <Spinner aria-labelledby="spinner-label" />
      <span id="spinner-label">Loading files</span>
    </div>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('progressbar', { name: 'Loading files' })).toBeVisible()
  },
}

export const Sizes: Story = {
  render: () => (
    <div className="flex items-center gap-4">
      <Spinner size="small" aria-label="Loading small preview" />
      <Spinner size="medium" aria-label="Loading medium preview" />
      <Spinner size="large" aria-label="Loading large preview" />
      <Spinner className="size-8 text-text-primary" aria-label="Loading custom preview" />
    </div>
  ),
}

export const Decorative: Story = {
  render: () => (
    <button
      type="button"
      disabled
      aria-label="Loading audio"
      className="flex size-6 items-center justify-center"
    >
      <SpinnerIcon />
    </button>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: 'Loading audio' })).toBeDisabled()
    await expect(canvas.queryByRole('progressbar')).not.toBeInTheDocument()
  },
}
