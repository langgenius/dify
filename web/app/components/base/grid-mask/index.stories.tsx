import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import GridMask from '.'

const meta = {
  title: 'Base/Layout/GridMask',
  component: GridMask,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'Displays a soft grid overlay with gradient mask, useful for framing hero sections or marketing callouts.',
      },
    },
  },
  args: {
    wrapperClassName: 'rounded-2xl p-10',
    canvasClassName: '',
    gradientClassName: '',
    children: (
      <div className="relative z-10 flex flex-col gap-3 text-left text-white">
        <span className="text-xs uppercase tracking-[0.16em] text-white/70">Grid Mask Demo</span>
        <span className="text-2xl font-semibold leading-tight">Beautiful backgrounds for feature highlights</span>
        <p className="max-w-md text-sm text-white/80">
          Place any content inside the mask. On dark backgrounds the grid and soft gradient add depth without distracting from the main message.
        </p>
      </div>
    ),
  },
  tags: ['autodocs'],
} satisfies Meta<typeof GridMask>

export default meta
type Story = StoryObj<typeof meta>

export const Playground: Story = {}

export const CustomBackground: Story = {
  args: {
    wrapperClassName: 'rounded-3xl p-10 bg-[#0A0A1A]',
    gradientClassName: 'bg-gradient-to-r from-[#0A0A1A]/90 via-[#101030]/60 to-[#05050A]/90',
    children: (
      <div className="flex flex-col gap-2 text-white">
        <span className="text-sm font-medium text-white/80">Custom gradient</span>
        <span className="text-3xl font-semibold leading-tight">Use your own colors</span>
        <p className="max-w-md text-sm text-white/70">
          Override gradient and canvas classes to match brand palettes while keeping the grid texture.
        </p>
      </div>
    ),
  },
}
