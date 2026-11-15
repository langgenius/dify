import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'
import { Separator } from '.'
import { Button } from '../button'
import { cn } from '../cn'
import { Toggle } from '../toggle'

const meta = {
  title: 'Base/UI/Separator',
  component: Separator,
  tags: ['autodocs'],
  argTypes: {
    orientation: { control: 'inline-radio', options: ['horizontal', 'vertical'] },
    variant: { control: 'inline-radio', options: ['solid', 'gradient'] },
    decorative: { control: 'boolean' },
  },
  parameters: {
    docs: {
      description: {
        component:
          'A static content separator. Use decorative for purely visual lines. Keep headings beside the line and use the owning menu family separator inside menus. The surrounding layout owns spacing and length.',
      },
    },
  },
} satisfies Meta<typeof Separator>

export default meta

type Story = StoryObj<typeof meta>

export const Playground: Story = {
  args: { orientation: 'horizontal', variant: 'solid', decorative: false },
  render: (args) => (
    <div className="w-full max-w-xl space-y-4">
      <div className="rounded-xl border border-divider-subtle bg-background-default p-6">
        <div
          className={cn(
            'flex gap-6',
            args.orientation === 'vertical' ? 'h-40 items-center' : 'flex-col',
          )}
        >
          <div className="min-w-0 flex-1 space-y-1">
            <h3 className="system-sm-semibold text-text-primary">Overview</h3>
            <p className="system-sm-regular text-text-tertiary">
              A short introduction to the content.
            </p>
          </div>
          <Separator {...args} />
          <div className="min-w-0 flex-1 space-y-1">
            <h3 className="system-sm-semibold text-text-primary">Details</h3>
            <p className="system-sm-regular text-text-tertiary">
              Additional information and context.
            </p>
          </div>
        </div>
      </div>
      <p className="system-xs-regular text-text-tertiary">
        Change orientation, variant, and decorative in Controls. Vertical lines need a container
        with a defined height.
      </p>
    </div>
  ),
}

export const ContentGroups: Story = {
  parameters: {
    controls: { disable: true },
    docs: { description: { story: 'The line marks a boundary between two groups of settings.' } },
  },
  render: () => (
    <div className="w-full max-w-120 rounded-xl border border-divider-subtle bg-background-default p-6">
      <section aria-labelledby="separator-typography-title">
        <h3 id="separator-typography-title" className="system-sm-semibold text-text-primary">
          Typography
        </h3>
        <dl className="mt-3 space-y-2 system-sm-regular">
          <div className="flex flex-wrap justify-between gap-x-4 gap-y-1">
            <dt className="text-text-tertiary">Font family</dt>
            <dd className="text-text-secondary">Inter</dd>
          </div>
          <div className="flex flex-wrap justify-between gap-x-4 gap-y-1">
            <dt className="text-text-tertiary">Font size</dt>
            <dd className="text-text-secondary">14 px</dd>
          </div>
        </dl>
      </section>
      <Separator className="my-5" />
      <section aria-labelledby="separator-spacing-title">
        <h3 id="separator-spacing-title" className="system-sm-semibold text-text-primary">
          Spacing
        </h3>
        <p className="mt-1 system-sm-regular text-text-tertiary">
          Space between text and surrounding elements.
        </p>
        <p className="mt-3 system-sm-medium text-text-secondary">16 px between paragraphs</p>
      </section>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const separator = within(canvasElement).getByRole('separator')
    expect(separator).toHaveAttribute('aria-orientation', 'horizontal')
    expect(separator).not.toHaveAttribute('tabindex')
  },
}

export const InlineActions: Story = {
  parameters: {
    controls: { disable: true },
    docs: {
      description: {
        story: 'A decorative line adds visual spacing between individual formatting controls.',
      },
    },
  },
  render: () => (
    <div className="w-full max-w-120 space-y-3">
      <div
        role="group"
        aria-label="Text formatting"
        className="inline-flex items-center gap-3 rounded-xl border border-divider-subtle bg-background-default p-3"
      >
        <Toggle
          render={<Button variant="ghost" />}
          className="font-bold data-pressed:bg-state-accent-active data-pressed:text-text-accent"
        >
          Bold
        </Toggle>
        <Separator decorative orientation="vertical" className="h-5" />
        <Toggle
          render={<Button variant="ghost" />}
          className="italic data-pressed:bg-state-accent-active data-pressed:text-text-accent"
        >
          Italic
        </Toggle>
      </div>
      <p className="system-xs-regular text-text-tertiary">
        The line is decorative; both controls remain independently focusable.
      </p>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.queryByRole('separator')).not.toBeInTheDocument()
    expect(canvasElement.querySelector('[data-orientation="vertical"]')).not.toHaveAttribute(
      'aria-orientation',
    )
  },
}

export const LabelComposition: Story = {
  parameters: {
    controls: { disable: true },
    docs: {
      description: {
        story:
          'Headings stay outside the decorative lines. Flexible line widths leave room for the label, including in narrow containers.',
      },
    },
  },
  render: () => (
    <div className="w-full max-w-xl space-y-8 rounded-xl border border-divider-subtle bg-background-default p-6">
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <h3 className="system-xs-semibold-uppercase text-text-secondary">Section title</h3>
          <Separator decorative variant="gradient" className="min-w-0 flex-1" />
        </div>
        <p className="system-sm-regular text-text-tertiary">
          A trailing gradient extends the section heading.
        </p>
      </div>
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <Separator decorative variant="gradient" className="min-w-0 flex-1 rotate-180" />
          <h3 className="text-center system-xs-semibold-uppercase text-text-secondary">
            Related content
          </h3>
          <Separator decorative variant="gradient" className="min-w-0 flex-1" />
        </div>
        <p className="text-center system-sm-regular text-text-tertiary">
          Mirrored gradients frame the heading without adding content boundaries.
        </p>
      </div>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('heading', { name: 'Section title' })).toBeVisible()
    expect(canvas.getByRole('heading', { name: 'Related content' })).toBeVisible()
    expect(canvas.queryByRole('separator')).not.toBeInTheDocument()
  },
}
