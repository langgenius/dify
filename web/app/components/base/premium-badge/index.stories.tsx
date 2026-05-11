import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import PremiumBadge, { PremiumBadgeButton } from '.'

const colors: Array<NonNullable<React.ComponentProps<typeof PremiumBadge>['color']>> = ['blue', 'indigo', 'gray', 'orange']

const PremiumBadgeGallery = ({
  size = 'm',
}: {
  size?: 's' | 'm'
}) => {
  return (
    <div className="flex w-full max-w-xl flex-col gap-4 rounded-2xl border border-divider-subtle bg-components-panel-bg p-6">
      <p className="text-xs tracking-[0.18em] text-text-tertiary uppercase">Brand badge variants</p>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {colors.map(color => (
          <div key={color} className="flex flex-col items-center gap-2 rounded-xl border border-transparent px-2 py-4 hover:border-divider-subtle hover:bg-background-default-subtle">
            <PremiumBadge color={color} size={size}>
              <span className="px-2 text-xs font-semibold tracking-[0.14em] uppercase">Premium</span>
            </PremiumBadge>
            <span className="text-[11px] tracking-[0.16em] text-text-tertiary uppercase">{color}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

const meta = {
  title: 'Base/General/PremiumBadge',
  component: PremiumBadgeGallery,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Gradient badge used for premium features and upsell prompts. Hover animations can be toggled per instance.',
      },
    },
  },
  argTypes: {
    size: {
      control: 'radio',
      options: ['s', 'm'],
    },
  },
  args: {
    size: 'm',
  },
  tags: ['autodocs'],
} satisfies Meta<typeof PremiumBadgeGallery>

export default meta
type Story = StoryObj<typeof meta>

export const Playground: Story = {}

export const Action: Story = {
  render: () => (
    <PremiumBadgeButton color="blue" onClick={() => {}}>
      <span className="px-2 text-xs font-semibold">Upgrade</span>
    </PremiumBadgeButton>
  ),
}
