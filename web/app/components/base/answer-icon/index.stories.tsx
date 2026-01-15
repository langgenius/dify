import type { Meta, StoryObj } from '@storybook/nextjs'
import type { ReactNode } from 'react'
import AnswerIcon from '.'

const SAMPLE_IMAGE = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" rx="40" ry="40" fill="%23EEF2FF"/><text x="50%" y="55%" dominant-baseline="middle" text-anchor="middle" font-size="34" font-family="Arial" fill="%233256D4">AI</text></svg>'

const meta = {
  title: 'Base/General/AnswerIcon',
  component: AnswerIcon,
  parameters: {
    docs: {
      description: {
        component: 'Circular avatar used for assistant answers. Supports emoji, solid background colour, or uploaded imagery.',
      },
    },
  },
  tags: ['autodocs'],
  args: {
    icon: '🤖',
    background: '#D5F5F6',
  },
} satisfies Meta<typeof AnswerIcon>

export default meta
type Story = StoryObj<typeof meta>

const StoryWrapper = (children: ReactNode) => (
  <div className="flex items-center gap-6">
    {children}
  </div>
)

export const Default: Story = {
  render: args => StoryWrapper(
    <div className="h-16 w-16">
      <AnswerIcon {...args} />
    </div>,
  ),
  parameters: {
    docs: {
      source: {
        language: 'tsx',
        code: `
<div className="h-16 w-16">
  <AnswerIcon icon="🤖" background="#D5F5F6" />
</div>
        `.trim(),
      },
    },
  },
}

export const CustomEmoji: Story = {
  render: args => StoryWrapper(
    <>
      <div className="h-16 w-16">
        <AnswerIcon {...args} icon="🧠" background="#FEE4E2" />
      </div>
      <div className="h-16 w-16">
        <AnswerIcon {...args} icon="🛠️" background="#EEF2FF" />
      </div>
    </>,
  ),
  parameters: {
    docs: {
      source: {
        language: 'tsx',
        code: `
<div className="flex gap-4">
  <div className="h-16 w-16">
    <AnswerIcon icon="🧠" background="#FEE4E2" />
  </div>
  <div className="h-16 w-16">
    <AnswerIcon icon="🛠️" background="#EEF2FF" />
  </div>
</div>
        `.trim(),
      },
    },
  },
}

export const ImageIcon: Story = {
  render: args => StoryWrapper(
    <div className="h-16 w-16">
      <AnswerIcon
        {...args}
        iconType="image"
        imageUrl={SAMPLE_IMAGE}
        background={undefined}
      />
    </div>,
  ),
  parameters: {
    docs: {
      source: {
        language: 'tsx',
        code: `
<AnswerIcon
  iconType="image"
  imageUrl="data:image/svg+xml;utf8,&lt;svg ...&gt;"
/>
        `.trim(),
      },
    },
  },
}
