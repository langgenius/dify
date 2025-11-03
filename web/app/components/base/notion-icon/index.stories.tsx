import type { Meta, StoryObj } from '@storybook/nextjs'
import NotionIcon from '.'

const meta = {
  title: 'Base/General/NotionIcon',
  component: NotionIcon,
  parameters: {
    docs: {
      description: {
        component: 'Renders workspace and page icons returned from Notion APIs, falling back to text initials or the default document glyph.',
      },
    },
  },
  tags: ['autodocs'],
  args: {
    type: 'workspace',
    name: 'Knowledge Base',
    src: 'https://cloud.dify.ai/logo/logo.svg',
  },
} satisfies Meta<typeof NotionIcon>

export default meta
type Story = StoryObj<typeof meta>

export const WorkspaceIcon: Story = {
  render: args => (
    <div className="flex items-center gap-3 rounded-lg border border-divider-subtle bg-components-panel-bg p-4">
      <NotionIcon {...args} />
      <span className="text-sm text-text-secondary">Workspace icon pulled from a remote URL.</span>
    </div>
  ),
  parameters: {
    docs: {
      source: {
        language: 'tsx',
        code: `
<NotionIcon
  type="workspace"
  name="Knowledge Base"
  src="https://cloud.dify.ai/logo/logo.svg"
/>`
          .trim(),
      },
    },
  },
}

export const WorkspaceInitials: Story = {
  render: args => (
    <div className="flex items-center gap-3 rounded-lg border border-divider-subtle bg-components-panel-bg p-4">
      <NotionIcon {...args} src={null} name="Operations" />
      <span className="text-sm text-text-secondary">Fallback initial rendered when no icon URL is available.</span>
    </div>
  ),
  parameters: {
    docs: {
      source: {
        language: 'tsx',
        code: `
<NotionIcon type="workspace" name="Operations" src={null} />`
          .trim(),
      },
    },
  },
}

export const PageEmoji: Story = {
  render: args => (
    <div className="flex items-center gap-3 rounded-lg border border-divider-subtle bg-components-panel-bg p-4">
      <NotionIcon {...args} type="page" src={{ type: 'emoji', emoji: '🧠', url: '' }} />
      <span className="text-sm text-text-secondary">Page-level emoji icon returned by the API.</span>
    </div>
  ),
  parameters: {
    docs: {
      source: {
        language: 'tsx',
        code: `
<NotionIcon type="page" src={{ type: 'emoji', emoji: '🧠' }} />`
          .trim(),
      },
    },
  },
}

export const PageImage: Story = {
  render: args => (
    <div className="flex items-center gap-3 rounded-lg border border-divider-subtle bg-components-panel-bg p-4">
      <NotionIcon
        {...args}
        type="page"
        src={{ type: 'url', url: 'https://images.unsplash.com/photo-1521737604893-d14cc237f11d?auto=format&fit=crop&w=80&q=60', emoji: '' }}
      />
      <span className="text-sm text-text-secondary">Page icon resolved from an image URL.</span>
    </div>
  ),
  parameters: {
    docs: {
      source: {
        language: 'tsx',
        code: `
<NotionIcon
  type="page"
  src={{ type: 'url', url: 'https://images.unsplash.com/photo-1521737604893-d14cc237f11d?auto=format&fit=crop&w=80&q=60' }}
/>`
          .trim(),
      },
    },
  },
}

export const DefaultIcon: Story = {
  render: args => (
    <div className="flex items-center gap-3 rounded-lg border border-divider-subtle bg-components-panel-bg p-4">
      <NotionIcon {...args} type="page" src={undefined} />
      <span className="text-sm text-text-secondary">When neither emoji nor URL is provided, the generic document icon is shown.</span>
    </div>
  ),
  parameters: {
    docs: {
      source: {
        language: 'tsx',
        code: `
<NotionIcon type="page" src={undefined} />`
          .trim(),
      },
    },
  },
}
