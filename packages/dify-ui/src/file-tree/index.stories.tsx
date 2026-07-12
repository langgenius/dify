import type { Meta, StoryObj } from '@storybook/react-vite'
import type { FileTreeIconType } from '.'
import * as React from 'react'
import { expect } from 'storybook/test'
import {
  FileTree,
  FileTreeBadge,
  FileTreeFile,
  FileTreeFolder,
  FileTreeFolderPanel,
  FileTreeFolderTrigger,
  FileTreeIcon,
  FileTreeLabel,
  FileTreeList,
  FileTreeMeta,
} from '.'

const meta = {
  title: 'Base/UI/FileTree',
  component: FileTree,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Composable file preview list built with Base UI Collapsible. Folders are disclosure buttons, files are preview buttons, and feature code owns data loading, routing, editing, drag-and-drop, and item actions.',
      },
    },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof FileTree>

export default meta
type Story = StoryObj<typeof meta>

type ExampleFileTreeNode = {
  id: string
  name: string
  icon: FileTreeIconType
  meta?: string
  badge?: string
  children?: ExampleFileTreeNode[]
}

const fileTreeData: ExampleFileTreeNode[] = [
  {
    id: 'app',
    name: 'app',
    icon: 'folder',
    children: [
      {
        id: 'app-components',
        name: 'components',
        icon: 'folder',
        children: [
          { id: 'app-components-file-tree', name: 'file-tree.tsx', icon: 'code' },
          { id: 'app-components-readme', name: 'README.md', icon: 'markdown' },
          { id: 'app-components-package', name: 'package.json', icon: 'json' },
        ],
      },
      { id: 'app-layout', name: 'layout.tsx', icon: 'code' },
      { id: 'app-theme', name: 'theme.css', icon: 'code', meta: 'global' },
    ],
  },
  {
    id: 'assets',
    name: 'assets',
    icon: 'folder',
    children: [
      { id: 'assets-hero', name: 'hero.png', icon: 'image' },
      { id: 'assets-export', name: 'export.zip', icon: 'archive', badge: '4 MB' },
    ],
  },
  { id: 'schema', name: 'schema.sqlite', icon: 'database' },
]

function FileTreeNodeRows({
  nodes,
  selectedItemId,
  onPreview,
}: {
  nodes: ExampleFileTreeNode[]
  selectedItemId: string | null
  onPreview: (itemId: string) => void
}) {
  return nodes.map((node) => {
    if (node.children?.length) {
      return (
        <FileTreeFolder key={node.id} defaultOpen={node.id === 'app' || node.id === 'app-components'}>
          <FileTreeFolderTrigger>
            <FileTreeIcon type="folder" />
            <FileTreeLabel>{node.name}</FileTreeLabel>
          </FileTreeFolderTrigger>
          <FileTreeFolderPanel>
            <FileTreeNodeRows
              nodes={node.children}
              selectedItemId={selectedItemId}
              onPreview={onPreview}
            />
          </FileTreeFolderPanel>
        </FileTreeFolder>
      )
    }

    return (
      <FileTreeFile
        key={node.id}
        selected={selectedItemId === node.id}
        onClick={() => onPreview(node.id)}
      >
        <FileTreeIcon type={node.icon} />
        <FileTreeLabel>{node.name}</FileTreeLabel>
        {node.meta && <FileTreeMeta>{node.meta}</FileTreeMeta>}
        {node.badge && <FileTreeBadge>{node.badge}</FileTreeBadge>}
      </FileTreeFile>
    )
  })
}

function ComposedFileTree() {
  const [selectedItemId, setSelectedItemId] = React.useState<string | null>('button')

  return (
    <FileTree
      aria-label="Project files"
      className="w-80 rounded-lg border border-divider-subtle bg-background-default-subtle"
    >
      <FileTreeList>
        <FileTreeFolder defaultOpen>
          <FileTreeFolderTrigger>
            <FileTreeIcon type="folder" />
            <FileTreeLabel>src</FileTreeLabel>
          </FileTreeFolderTrigger>
          <FileTreeFolderPanel>
            <FileTreeFolder defaultOpen>
              <FileTreeFolderTrigger>
                <FileTreeIcon type="folder" />
                <FileTreeLabel>components</FileTreeLabel>
              </FileTreeFolderTrigger>
              <FileTreeFolderPanel>
                <FileTreeFile selected={selectedItemId === 'button'} onClick={() => setSelectedItemId('button')}>
                  <FileTreeIcon type="code" />
                  <FileTreeLabel>button.tsx</FileTreeLabel>
                </FileTreeFile>
                <FileTreeFile selected={selectedItemId === 'dialog'} onClick={() => setSelectedItemId('dialog')}>
                  <FileTreeIcon type="code" />
                  <FileTreeLabel>dialog.tsx</FileTreeLabel>
                </FileTreeFile>
                <FileTreeFile selected={selectedItemId === 'readme'} onClick={() => setSelectedItemId('readme')}>
                  <FileTreeIcon type="markdown" />
                  <FileTreeLabel>README.md</FileTreeLabel>
                </FileTreeFile>
                <FileTreeFile selected={selectedItemId === 'config'} onClick={() => setSelectedItemId('config')}>
                  <FileTreeIcon type="json" />
                  <FileTreeLabel>config.json</FileTreeLabel>
                </FileTreeFile>
              </FileTreeFolderPanel>
            </FileTreeFolder>
            <FileTreeFile selected={selectedItemId === 'index'} onClick={() => setSelectedItemId('index')}>
              <FileTreeIcon type="code" />
              <FileTreeLabel>index.ts</FileTreeLabel>
            </FileTreeFile>
          </FileTreeFolderPanel>
        </FileTreeFolder>
        <FileTreeFile selected={selectedItemId === 'hero'} onClick={() => setSelectedItemId('hero')}>
          <FileTreeIcon type="image" />
          <FileTreeLabel>hero.png</FileTreeLabel>
        </FileTreeFile>
        <FileTreeFile selected={selectedItemId === 'license'} onClick={() => setSelectedItemId('license')}>
          <FileTreeIcon type="text" />
          <FileTreeLabel>LICENSE</FileTreeLabel>
          <FileTreeMeta>root</FileTreeMeta>
        </FileTreeFile>
      </FileTreeList>
    </FileTree>
  )
}

function DataDrivenFileTree() {
  const [selectedItemId, setSelectedItemId] = React.useState<string | null>('app-components-file-tree')

  return (
    <FileTree
      aria-label="Data-driven project files"
      className="w-80 rounded-lg border border-divider-subtle bg-background-default-subtle"
    >
      <FileTreeList>
        <FileTreeNodeRows
          nodes={fileTreeData}
          selectedItemId={selectedItemId}
          onPreview={setSelectedItemId}
        />
      </FileTreeList>
    </FileTree>
  )
}

function IconGallery() {
  const iconTypes = [
    'folder',
    'file',
    'markdown',
    'json',
    'image',
    'code',
    'database',
    'text',
    'pdf',
    'table',
    'archive',
  ] as const

  return (
    <FileTree aria-label="File icon examples" className="w-64 rounded-lg border border-divider-subtle bg-background-default-subtle">
      <FileTreeList>
        {iconTypes.map(type => (
          type === 'folder'
            ? (
                <FileTreeFolder key={type}>
                  <FileTreeFolderTrigger>
                    <FileTreeIcon type={type} />
                    <FileTreeLabel>{type}</FileTreeLabel>
                  </FileTreeFolderTrigger>
                  <FileTreeFolderPanel />
                </FileTreeFolder>
              )
            : (
                <FileTreeFile key={type}>
                  <FileTreeIcon type={type} />
                  <FileTreeLabel>{type}</FileTreeLabel>
                </FileTreeFile>
              )
        ))}
      </FileTreeList>
    </FileTree>
  )
}

function StateFrame({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="w-80 min-w-0 space-y-1">
      <div className="system-xs-medium-uppercase text-text-tertiary">{label}</div>
      <FileTree aria-label={label} className="rounded-lg border border-divider-subtle bg-background-default-subtle">
        <FileTreeList>
          {children}
        </FileTreeList>
      </FileTree>
    </div>
  )
}

function VisualStates() {
  return (
    <div className="grid gap-4">
      <StateFrame label="Default file">
        <FileTreeFile>
          <FileTreeIcon type="file" />
          <FileTreeLabel>default.txt</FileTreeLabel>
        </FileTreeFile>
      </StateFrame>
      <StateFrame label="Selected file">
        <FileTreeFile selected>
          <FileTreeIcon type="markdown" />
          <FileTreeLabel>active.md</FileTreeLabel>
        </FileTreeFile>
      </StateFrame>
      <StateFrame label="Disabled file">
        <FileTreeFile disabled>
          <FileTreeIcon type="json" />
          <FileTreeLabel>disabled.json</FileTreeLabel>
        </FileTreeFile>
      </StateFrame>
      <StateFrame label="Disabled folder">
        <FileTreeFolder disabled>
          <FileTreeFolderTrigger>
            <FileTreeIcon type="folder" />
            <FileTreeLabel>disabled-folder</FileTreeLabel>
          </FileTreeFolderTrigger>
          <FileTreeFolderPanel>
            <FileTreeFile>
              <FileTreeIcon type="code" />
              <FileTreeLabel>nested.ts</FileTreeLabel>
            </FileTreeFile>
          </FileTreeFolderPanel>
        </FileTreeFolder>
      </StateFrame>
      <StateFrame label="Closed folder">
        <FileTreeFolder>
          <FileTreeFolderTrigger>
            <FileTreeIcon type="folder" />
            <FileTreeLabel>closed-folder</FileTreeLabel>
          </FileTreeFolderTrigger>
          <FileTreeFolderPanel>
            <FileTreeFile>
              <FileTreeIcon type="code" />
              <FileTreeLabel>nested.ts</FileTreeLabel>
            </FileTreeFile>
          </FileTreeFolderPanel>
        </FileTreeFolder>
      </StateFrame>
      <StateFrame label="Open folder">
        <FileTreeFolder defaultOpen>
          <FileTreeFolderTrigger>
            <FileTreeIcon type="folder" />
            <FileTreeLabel>open-folder</FileTreeLabel>
          </FileTreeFolderTrigger>
          <FileTreeFolderPanel>
            <FileTreeFile>
              <FileTreeIcon type="code" />
              <FileTreeLabel>nested.ts</FileTreeLabel>
            </FileTreeFile>
          </FileTreeFolderPanel>
        </FileTreeFolder>
      </StateFrame>
      <StateFrame label="Long label">
        <FileTreeFile selected>
          <FileTreeIcon type="text" />
          <FileTreeLabel>very-long-file-name-that-should-truncate-without-shifting-layout.txt</FileTreeLabel>
          <FileTreeMeta>preview</FileTreeMeta>
        </FileTreeFile>
      </StateFrame>
    </div>
  )
}

export const Default: Story = {
  render: () => <ComposedFileTree />,
  play: async ({ canvas, userEvent }) => {
    const srcFolder = canvas.getByRole('button', { name: 'src' })

    await expect(canvas.getByRole('button', { name: 'components' })).toBeVisible()

    await userEvent.click(srcFolder)
    await expect(srcFolder).toHaveAttribute('aria-expanded', 'false')
    await expect(canvas.queryByRole('button', { name: 'components' })).not.toBeInTheDocument()

    await userEvent.click(srcFolder)
    await expect(srcFolder).toHaveAttribute('aria-expanded', 'true')
    await expect(canvas.getByRole('button', { name: 'components' })).toBeVisible()
  },
}

export const DataDriven: Story = {
  render: () => <DataDrivenFileTree />,
}

export const Icons: Story = {
  render: () => <IconGallery />,
}

export const States: Story = {
  render: () => <VisualStates />,
}
