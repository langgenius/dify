import type { Meta, StoryObj } from '@storybook/nextjs'
import Loading from '.'

const meta = {
  title: 'Base/Feedback/Loading',
  component: Loading,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Spinner used while fetching data (`area`) or bootstrapping the full application shell (`app`).',
      },
    },
  },
  argTypes: {
    type: {
      control: 'radio',
      options: ['area', 'app'],
    },
  },
  args: {
    type: 'area',
  },
  tags: ['autodocs'],
} satisfies Meta<typeof Loading>

export default meta
type Story = StoryObj<typeof meta>

const LoadingPreview = ({ type }: { type: 'area' | 'app' }) => {
  const containerHeight = type === 'app' ? 'h-48' : 'h-20'
  const title = type === 'app' ? 'App loading state' : 'Inline loading state'

  return (
    <div className="flex flex-col items-center gap-4">
      <span className="text-xs uppercase tracking-[0.18em] text-text-tertiary">{title}</span>
      <div
        className={`flex w-64 items-center justify-center rounded-xl border border-divider-subtle bg-background-default-subtle ${containerHeight}`}
      >
        <Loading type={type} />
      </div>
    </div>
  )
}

export const AreaSpinner: Story = {
  render: () => <LoadingPreview type="area" />,
}

export const AppSpinner: Story = {
  render: () => <LoadingPreview type="app" />,
}
