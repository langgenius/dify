import type { BuiltInMetadataItem, MetadataItemWithValueLength } from '../../types'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vite-plus/test'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { DataType } from '../../types'
import DatasetMetadataDrawer from '../dataset-metadata-drawer'

// Mock service/API calls
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'datasets.byDatasetId.metadata.get': async () => ({
        doc_metadata: [{ id: '1', name: 'existing_field', type: DataType.string }],
      }),
    }),
  }
})

const mockToastNotify = vi.fn()
vi.mock('@/app/notifications', () => ({
  default: {
    notify: (args: unknown) => mockToastNotify(args),
  },
  toast: {
    success: (message: string) => mockToastNotify({ type: 'success', message }),
    error: (message: string) => mockToastNotify({ type: 'error', message }),
    warning: (message: string) => mockToastNotify({ type: 'warning', message }),
    info: (message: string) => mockToastNotify({ type: 'info', message }),
  },
}))

describe('DatasetMetadataDrawer', () => {
  const mockUserMetadata: MetadataItemWithValueLength[] = [
    { id: '1', name: 'field_one', type: DataType.string, count: 5 },
    { id: '2', name: 'field_two', type: DataType.number, count: 3 },
  ]

  const mockBuiltInMetadata: BuiltInMetadataItem[] = [
    { name: 'created_at', type: DataType.time },
    { name: 'modified_at', type: DataType.time },
  ]

  const defaultProps = {
    userMetadata: mockUserMetadata,
    builtInMetadata: mockBuiltInMetadata,
    isBuiltInEnabled: false,
    onIsBuiltInEnabledChange: vi.fn(),
    onClose: vi.fn(),
    onAdd: vi.fn().mockResolvedValue({}),
    onRename: vi.fn().mockResolvedValue({}),
    onRemove: vi.fn().mockResolvedValue({}),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renames the focused editable field with its identity intact', async () => {
    const user = userEvent.setup()
    render(<DatasetMetadataDrawer {...defaultProps} />)
    const addButton = await screen.findByRole('button', {
      name: 'dataset.metadata.datasetMetadata.addMetaData',
    })
    expect(screen.getAllByRole('button', { name: 'common.operation.edit' })).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: 'common.operation.remove' })).toHaveLength(2)
    addButton.focus()
    await user.tab()
    expect(screen.getAllByRole('button', { name: 'common.operation.edit' })[0]).toHaveFocus()
    await user.keyboard('{Enter}')
    const input = await screen.findByRole('textbox', {
      name: 'dataset.metadata.datasetMetadata.name',
    })
    expect(input).toHaveValue('field_one')
    await user.clear(input)
    await user.type(input, 'renamed_field')
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
    await waitFor(() =>
      expect(defaultProps.onRename).toHaveBeenCalledWith({
        ...mockUserMetadata[0],
        name: 'renamed_field',
      }),
    )
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'dataset.metadata.datasetMetadata.rename' }),
      ).not.toBeInTheDocument(),
    )
  })

  it('discards a canceled rename while keeping the drawer open', async () => {
    const user = userEvent.setup()
    render(<DatasetMetadataDrawer {...defaultProps} />)
    await user.click(screen.getAllByRole('button', { name: 'common.operation.edit' })[1]!)
    const input = await screen.findByRole('textbox', {
      name: 'dataset.metadata.datasetMetadata.name',
    })
    await user.clear(input)
    await user.type(input, 'discarded')
    await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'dataset.metadata.datasetMetadata.rename' }),
      ).not.toBeInTheDocument(),
    )
    expect(defaultProps.onRename).not.toHaveBeenCalled()
    await user.click(screen.getAllByRole('button', { name: 'common.operation.edit' })[1]!)
    expect(
      await screen.findByRole('textbox', { name: 'dataset.metadata.datasetMetadata.name' }),
    ).toHaveValue('field_two')
  })

  it('creates metadata with the chosen name and closes the editor', async () => {
    const user = userEvent.setup()
    render(<DatasetMetadataDrawer {...defaultProps} />)
    await user.click(
      screen.getByRole('button', { name: 'dataset.metadata.datasetMetadata.addMetaData' }),
    )
    await user.type(
      await screen.findByRole('textbox', { name: 'dataset.metadata.createMetadata.name' }),
      'new_field',
    )
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
    await waitFor(() =>
      expect(defaultProps.onAdd).toHaveBeenCalledWith({ name: 'new_field', type: DataType.string }),
    )
    await waitFor(() =>
      expect(
        screen.queryByRole('textbox', { name: 'dataset.metadata.createMetadata.name' }),
      ).not.toBeInTheDocument(),
    )
  })

  it('requires confirmation before deleting the selected field', async () => {
    const user = userEvent.setup()
    function MetadataDrawer() {
      const [metadata, setMetadata] = useState(mockUserMetadata)
      return (
        <DatasetMetadataDrawer
          {...defaultProps}
          userMetadata={metadata}
          onRemove={(id) => {
            defaultProps.onRemove(id)
            setMetadata((items) => items.filter((item) => item.id !== id))
          }}
        />
      )
    }
    render(<MetadataDrawer />)
    await user.click(screen.getAllByRole('button', { name: 'common.operation.remove' })[1]!)
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: 'common.operation.cancel',
      }),
    )
    expect(defaultProps.onRemove).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    await user.click(screen.getAllByRole('button', { name: 'common.operation.remove' })[1]!)
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: 'common.operation.confirm',
      }),
    )
    await waitFor(() => expect(defaultProps.onRemove).toHaveBeenCalledExactlyOnceWith('2'))
    await waitFor(() => expect(screen.queryByText('field_two')).not.toBeInTheDocument())
    expect(screen.getByText('field_one')).toBeInTheDocument()
    expect(mockToastNotify).not.toHaveBeenCalled()
  })

  it.each([false, true])(
    'requests the opposite built-in setting when enabled=%s',
    async (enabled) => {
      const user = userEvent.setup()
      render(<DatasetMetadataDrawer {...defaultProps} isBuiltInEnabled={enabled} />)
      await user.click(
        screen.getByRole('switch', { name: 'dataset.metadata.datasetMetadata.builtIn' }),
      )
      expect(defaultProps.onIsBuiltInEnabledChange).toHaveBeenCalledExactlyOnceWith(
        !enabled,
        expect.anything(),
      )
    },
  )

  it('closes the drawer from its close action', async () => {
    const user = userEvent.setup()
    render(<DatasetMetadataDrawer {...defaultProps} />)
    await user.click(screen.getByRole('button', { name: 'common.operation.close' }))
    expect(defaultProps.onClose).toHaveBeenCalledTimes(1)
  })
})
