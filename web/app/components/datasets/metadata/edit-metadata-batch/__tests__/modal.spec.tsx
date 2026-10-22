import type { MetadataItemInBatchEdit } from '../../types'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vite-plus/test'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { DataType, UpdateType } from '../../types'
import EditMetadataBatchModal from '../modal'

// Mock service/API calls
const mockDoAddMetaData = vi.fn().mockResolvedValue({})
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'datasets.byDatasetId.metadata.post': (input) => mockDoAddMetaData(input),
      'datasets.byDatasetId.metadata.get': async () => ({
        doc_metadata: [
          { id: 'existing-1', name: 'existing_field', type: DataType.string },
          { id: 'existing-2', name: 'another_field', type: DataType.number },
        ],
      }),
    }),
  }
})

// Mock Toast to verify notifications
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

describe('EditMetadataBatchModal', () => {
  const mockList: MetadataItemInBatchEdit[] = [
    { id: '1', name: 'field_one', type: DataType.string, value: 'Value 1', isMultipleValue: false },
    { id: '2', name: 'field_two', type: DataType.number, value: 42, isMultipleValue: false },
  ]

  const defaultProps = {
    datasetId: 'ds-1',
    documentNum: 5,
    list: mockList,
    onSave: vi.fn(),
    onHide: vi.fn(),
    onShowManage: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each([false, true])(
    'saves edited and newly added values with apply-to-all=%s',
    async (applyToAll) => {
      const user = userEvent.setup()
      render(<EditMetadataBatchModal {...defaultProps} />)
      const field = screen.getByRole('textbox', { name: 'field_one' })
      await user.clear(field)
      await user.type(field, 'Changed value')
      await user.click(screen.getByRole('button', { name: 'dataset.metadata.addMetadata' }))
      await user.click(await screen.findByRole('option', { name: /existing_field/ }))
      await user.type(screen.getByRole('textbox', { name: 'existing_field' }), 'Added value')
      if (applyToAll)
        await user.click(
          screen.getByRole('checkbox', {
            name: 'dataset.metadata.batchEditMetadata.applyToAllSelectDocument',
          }),
        )
      await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
      expect(defaultProps.onSave).toHaveBeenCalledExactlyOnceWith(
        [
          {
            ...mockList[0],
            value: 'Changed value',
            isUpdated: true,
            updateType: UpdateType.changeValue,
          },
          mockList[1],
        ],
        [{ id: 'existing-1', name: 'existing_field', type: DataType.string, value: 'Added value' }],
        applyToAll,
      )
    },
  )

  it('excludes removed existing and newly added metadata from the saved payload', async () => {
    const user = userEvent.setup()
    render(<EditMetadataBatchModal {...defaultProps} />)
    await user.click(screen.getByRole('button', { name: 'common.operation.delete field_one' }))
    await user.click(screen.getByRole('button', { name: 'dataset.metadata.addMetadata' }))
    await user.click(await screen.findByRole('option', { name: /existing_field/ }))
    await user.click(screen.getByRole('button', { name: 'common.operation.remove existing_field' }))
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
    expect(defaultProps.onSave).toHaveBeenCalledExactlyOnceWith([mockList[1]], [], false)
  })

  it.each(['edit', 'delete'])(
    'restores the original field after resetting a %s',
    async (operation) => {
      const user = userEvent.setup()
      render(<EditMetadataBatchModal {...defaultProps} />)
      if (operation === 'edit') {
        await user.clear(screen.getByRole('textbox', { name: 'field_one' }))
        await user.type(screen.getByRole('textbox', { name: 'field_one' }), 'Discarded')
      } else {
        await user.click(screen.getByRole('button', { name: 'common.operation.delete field_one' }))
      }
      await user.click(screen.getByRole('button', { name: 'common.operation.reset field_one' }))
      expect(screen.getByRole('textbox', { name: 'field_one' })).toHaveValue('Value 1')
      await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
      expect(defaultProps.onSave).toHaveBeenCalledExactlyOnceWith(
        [{ ...mockList[0], isUpdated: false }, mockList[1]],
        [],
        false,
      )
    },
  )

  it.each(['created_field', 'Invalid name'])(
    'validates new metadata before creating %s',
    async (name) => {
      const user = userEvent.setup()
      render(<EditMetadataBatchModal {...defaultProps} />)
      await user.click(screen.getByRole('button', { name: 'dataset.metadata.addMetadata' }))
      await user.click(
        screen.getByRole('button', { name: 'dataset.metadata.selectMetadata.newAction' }),
      )
      const input = screen.getByRole('textbox', { name: 'dataset.metadata.createMetadata.name' })
      await user.type(input, name)
      // The metadata editor is a popover dialog inside the batch editor.
      const editor = screen.getByRole('dialog', { name: 'dataset.metadata.addMetadata' })
      await user.click(within(editor).getByRole('button', { name: 'common.operation.save' }))
      if (name === 'created_field') {
        await waitFor(() =>
          expect(mockDoAddMetaData).toHaveBeenCalledExactlyOnceWith({
            params: { dataset_id: 'ds-1' },
            body: { name, type: DataType.string },
          }),
        )
        await waitFor(() =>
          expect(
            screen.queryByRole('textbox', { name: 'dataset.metadata.createMetadata.name' }),
          ).not.toBeInTheDocument(),
        )
        expect(await screen.findByRole('option', { name: /existing_field/ })).toBeInTheDocument()
        expect(mockToastNotify).not.toHaveBeenCalled()
      } else {
        expect(mockDoAddMetaData).not.toHaveBeenCalled()
        expect(mockToastNotify).toHaveBeenCalledWith({
          type: 'error',
          message: 'dataset.metadata.checkName.invalid',
        })
      }
    },
  )

  it('opens metadata management without saving the batch', async () => {
    const user = userEvent.setup()
    render(<EditMetadataBatchModal {...defaultProps} />)
    await user.click(screen.getByRole('button', { name: 'dataset.metadata.addMetadata' }))
    await user.click(
      screen.getByRole('button', { name: 'dataset.metadata.selectMetadata.manageAction' }),
    )
    expect(defaultProps.onShowManage).toHaveBeenCalledTimes(1)
    expect(defaultProps.onSave).not.toHaveBeenCalled()
  })

  it.each(['cancel', 'close'])('discards edits via %s', async (action) => {
    const user = userEvent.setup()
    render(<EditMetadataBatchModal {...defaultProps} />)
    await user.type(screen.getByRole('textbox', { name: 'field_one' }), ' unsaved')
    await user.click(screen.getByRole('button', { name: `common.operation.${action}` }))
    expect(defaultProps.onHide).toHaveBeenCalledTimes(1)
    expect(defaultProps.onSave).not.toHaveBeenCalled()
  })
})
