import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'
import { Separator } from '.'

const meta = {
  title: 'Base/UI/Separator',
  component: Separator,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'A static content separator. Set decorative=true for visual lines that do not separate content groups. Use the menu family separator inside menus. Labels and headings remain siblings, not children. Spacing belongs to the surrounding layout.',
      },
    },
  },
} satisfies Meta<typeof Separator>

export default meta

type Story = StoryObj<typeof meta>

export const Decorative: Story = {
  render: () => (
    <div className="flex h-6 items-center gap-2 text-text-primary">
      <span>Language</span>
      <Separator decorative orientation="vertical" />
      <span>Theme</span>
    </div>
  ),
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).queryByRole('separator')).not.toBeInTheDocument()
    expect(canvasElement.querySelector('[data-orientation="vertical"]')).not.toHaveAttribute(
      'aria-orientation',
    )
  },
}

export const Semantic: Story = {
  render: () => (
    <div className="flex flex-col gap-4 text-text-primary">
      <p>The first part of the story.</p>
      <Separator />
      <p>Later that evening, a new chapter begins.</p>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const separator = within(canvasElement).getByRole('separator')
    expect(separator).toHaveAttribute('aria-orientation', 'horizontal')
    expect(separator).not.toHaveAttribute('tabindex')
  },
}

export const VerticalSemantic: Story = {
  args: { orientation: 'vertical', className: 'h-12' },
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).getByRole('separator')).toHaveAttribute(
      'aria-orientation',
      'vertical',
    )
  },
}

export const DesignVariants: Story = {
  render: () => (
    <div className="flex max-w-172 flex-col gap-8">
      <Separator />
      <Separator variant="gradient" />
      <div className="flex items-center gap-2">
        <h3 className="shrink-0 system-xs-medium-uppercase text-text-tertiary">Label</h3>
        <Separator decorative variant="gradient" className="min-w-0 flex-1" />
      </div>
      <div className="flex items-center gap-2">
        <Separator decorative variant="gradient" className="min-w-0 flex-1 rotate-180" />
        <h3 className="shrink-0 system-2xs-semibold-uppercase text-text-secondary">Label</h3>
        <Separator decorative variant="gradient" className="min-w-0 flex-1" />
      </div>
    </div>
  ),
}
