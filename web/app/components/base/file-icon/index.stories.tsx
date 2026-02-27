import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import FileIcon from '.'

const meta = {
  title: 'Base/General/FileIcon',
  component: FileIcon,
  parameters: {
    docs: {
      description: {
        component: 'Maps a file extension to the appropriate SVG icon used across upload and attachment surfaces.',
      },
    },
  },
  tags: ['autodocs'],
  argTypes: {
    type: {
      control: 'text',
      description: 'File extension or identifier used to resolve the icon.',
    },
    className: {
      control: 'text',
      description: 'Custom classes passed to the SVG wrapper.',
    },
  },
  args: {
    type: 'pdf',
    className: 'h-10 w-10',
  },
} satisfies Meta<typeof FileIcon>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: args => (
    <div className="flex items-center gap-4 rounded-lg border border-divider-subtle bg-components-panel-bg p-4">
      <FileIcon {...args} />
      <span className="text-sm text-text-secondary">
        Extension:
        {args.type}
      </span>
    </div>
  ),
  parameters: {
    docs: {
      source: {
        language: 'tsx',
        code: `
<FileIcon type="pdf" className="h-10 w-10" />
        `.trim(),
      },
    },
  },
}

export const Gallery: Story = {
  render: () => {
    const examples = ['pdf', 'docx', 'xlsx', 'csv', 'json', 'md', 'txt', 'html', 'notion', 'unknown']
    return (
      <div className="grid grid-cols-5 gap-4 rounded-lg border border-divider-subtle bg-components-panel-bg p-4">
        {examples.map(type => (
          <div key={type} className="flex flex-col items-center gap-1">
            <FileIcon type={type} className="h-9 w-9" />
            <span className="text-xs uppercase text-text-tertiary">{type}</span>
          </div>
        ))}
      </div>
    )
  },
  parameters: {
    docs: {
      source: {
        language: 'tsx',
        code: `
{['pdf','docx','xlsx','csv','json','md','txt','html','notion','unknown'].map(type => (
  <FileIcon key={type} type={type} className="h-9 w-9" />
))}
        `.trim(),
      },
    },
  },
}
