import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import type { IconPickerValue } from '.'
import { useState } from 'react'
import { IconPickerDialog } from '.'

const meta = {
  title: 'Base/Data Entry/IconPickerDialog',
  component: IconPickerDialog,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Modal workflow for choosing an application avatar. Users can switch between emoji selections and image uploads (when enabled).',
      },
    },
    nextjs: {
      appDirectory: true,
      navigation: {
        pathname: '/apps/demo-app/icon-picker',
        params: { appId: 'demo-app' },
      },
    },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof IconPickerDialog>

export default meta
type Story = StoryObj<typeof meta>

const IconPickerDialogDemo = () => {
  const [open, setOpen] = useState(false)
  const [selection, setSelection] = useState<IconPickerValue | null>(null)

  return (
    <div className="flex min-h-80 flex-col items-start gap-4 px-6 py-8 md:px-12">
      <button
        type="button"
        className="rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-primary-700"
        onClick={() => setOpen(true)}
      >
        Choose icon…
      </button>

      <div className="rounded-lg border border-divider-subtle bg-components-panel-bg p-4 text-sm text-text-secondary shadow-sm">
        <div className="font-medium text-text-primary">Selection preview</div>
        <pre className="mt-2 max-h-44 overflow-auto rounded-md bg-background-default-subtle p-3 font-mono text-xs/tight text-text-primary">
          {selection ? JSON.stringify(selection, null, 2) : 'No icon selected yet.'}
        </pre>
      </div>

      <IconPickerDialog open={open} onOpenChange={setOpen} onConfirm={setSelection} />
    </div>
  )
}

export const Playground: Story = {
  args: {
    open: false,
    onOpenChange: () => {},
    onConfirm: () => {},
  },
  render: () => <IconPickerDialogDemo />,
  parameters: {
    docs: {
      source: {
        language: 'tsx',
        code: `
const [open, setOpen] = useState(false)
const [selection, setSelection] = useState<IconPickerValue | null>(null)

return (
  <>
    <button onClick={() => setOpen(true)}>Choose icon…</button>
    <IconPickerDialog
      open={open}
      onOpenChange={setOpen}
      onConfirm={setSelection}
    />
  </>
)
        `.trim(),
      },
    },
  },
}
