import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import Tag from '.'

const COLORS: Array<NonNullable<React.ComponentProps<typeof Tag>['color']>> = ['green', 'yellow', 'red', 'gray']

const TagGallery = ({
  bordered = false,
  hideBg = false,
}: {
  bordered?: boolean
  hideBg?: boolean
}) => {
  return (
    <div className="flex w-full max-w-md flex-col gap-4 rounded-2xl border border-divider-subtle bg-components-panel-bg p-6">
      <div className="text-xs uppercase tracking-[0.18em] text-text-tertiary">Tag variants</div>
      <div className="grid grid-cols-2 gap-3">
        {COLORS.map(color => (
          <div key={color} className="flex flex-col items-start gap-2 rounded-xl border border-transparent px-3 py-2 hover:border-divider-subtle hover:bg-background-default-subtle">
            <Tag color={color} bordered={bordered} hideBg={hideBg}>
              {color.charAt(0).toUpperCase() + color.slice(1)}
            </Tag>
            <span className="text-[11px] uppercase tracking-[0.16em] text-text-quaternary">{color}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

const meta = {
  title: 'Base/Data Display/Tag',
  component: TagGallery,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Color-coded label component. Toggle borders or remove background to fit dark/light surfaces.',
      },
    },
  },
  argTypes: {
    bordered: { control: 'boolean' },
    hideBg: { control: 'boolean' },
  },
  args: {
    bordered: false,
    hideBg: false,
  },
  tags: ['autodocs'],
} satisfies Meta<typeof TagGallery>

export default meta
type Story = StoryObj<typeof meta>

export const Playground: Story = {}

export const Outlined: Story = {
  args: {
    bordered: true,
    hideBg: true,
  },
}
