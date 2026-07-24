import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import FileTypeIcon from './file-type-icon'
import { FileAppearanceTypeEnum } from './types'

const meta = {
  title: 'Base/General/FileTypeIcon',
  component: FileTypeIcon,
  parameters: {
    docs: {
      description: {
        component: 'Displays the appropriate icon and accent colour for a file appearance type. Useful in lists and attachments.',
      },
    },
  },
  tags: ['autodocs'],
  args: {
    type: FileAppearanceTypeEnum.document,
    size: 'md',
  },
} satisfies Meta<typeof FileTypeIcon>

export default meta
type Story = StoryObj<typeof meta>

export const Playground: Story = {}

export const Gallery: Story = {
  render: () => (
    <div className="grid grid-cols-4 gap-6 rounded-xl border border-divider-subtle bg-components-panel-bg p-6">
      {Object.values(FileAppearanceTypeEnum).map(type => (
        <div key={type} className="flex flex-col items-center gap-2 text-xs text-text-secondary">
          <FileTypeIcon type={type} size="xl" />
          <span className="capitalize">{type}</span>
        </div>
      ))}
    </div>
  ),
}
