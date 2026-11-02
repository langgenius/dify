import type { MetadataItem } from '../../types'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { DataType } from '../../types'
import { DatasetMetadataPicker } from '../dataset-metadata-picker'

const { mockDatasetMetadataQuery } = vi.hoisted(() => ({
  mockDatasetMetadataQuery: vi.fn(),
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'datasets.byDatasetId.metadata.get': mockDatasetMetadataQuery,
    }),
  }
})

const metadataItems: MetadataItem[] = [
  { id: '1', name: 'field_one', type: DataType.string },
  { id: '2', name: 'field_two', type: DataType.number },
  { id: '3', name: 'field_three', type: DataType.time },
]

function renderDatasetMetadataPicker(
  overrides: Partial<React.ComponentProps<typeof DatasetMetadataPicker>> = {},
) {
  const props = {
    datasetId: 'dataset-1',
    onSelectMetadata: vi.fn(),
    onCreateMetadata: vi.fn(),
    onOpenMetadataManagement: vi.fn(),
    ...overrides,
  }

  return {
    props,
    ...render(<DatasetMetadataPicker {...props} />),
  }
}

describe('DatasetMetadataPicker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDatasetMetadataQuery.mockResolvedValue({ doc_metadata: metadataItems })
  })

  describe('Search', () => {
    it('should filter metadata options by search query', async () => {
      const user = userEvent.setup()
      renderDatasetMetadataPicker()

      await user.click(screen.getByRole('button', { name: 'dataset.metadata.addMetadata' }))
      await screen.findByRole('option', { name: /field_one/ })
      await user.type(
        screen.getByRole('combobox', { name: 'dataset.metadata.selectMetadata.search' }),
        'two',
      )

      expect(screen.getByRole('option', { name: /field_two/ })).toBeInTheDocument()
      expect(screen.queryByRole('option', { name: /field_one/ })).not.toBeInTheDocument()
      expect(screen.queryByRole('option', { name: /field_three/ })).not.toBeInTheDocument()
    })

    it('should show an empty state when no metadata matches', async () => {
      const user = userEvent.setup()
      renderDatasetMetadataPicker()

      await user.click(screen.getByRole('button', { name: 'dataset.metadata.addMetadata' }))
      await screen.findByRole('option', { name: /field_one/ })
      await user.type(
        screen.getByRole('combobox', { name: 'dataset.metadata.selectMetadata.search' }),
        'missing',
      )

      expect(await screen.findByRole('status')).toHaveTextContent('common.noData')
    })

    it('should reset the search query after the picker finishes closing', async () => {
      const user = userEvent.setup()
      renderDatasetMetadataPicker()

      const trigger = screen.getByRole('button', { name: 'dataset.metadata.addMetadata' })
      await user.click(trigger)
      await screen.findByRole('option', { name: /field_one/ })
      await user.type(
        screen.getByRole('combobox', { name: 'dataset.metadata.selectMetadata.search' }),
        'two',
      )
      await user.keyboard('{Escape}')
      await waitFor(() => {
        expect(trigger).toHaveAttribute('aria-expanded', 'false')
      })

      await user.click(trigger)
      expect(
        screen.getByRole('combobox', { name: 'dataset.metadata.selectMetadata.search' }),
      ).toHaveValue('')
      expect(screen.getByRole('option', { name: /field_one/ })).toBeInTheDocument()
      expect(screen.getByRole('option', { name: /field_three/ })).toBeInTheDocument()
    })
  })

  describe('Selection', () => {
    it('should call onSelectMetadata and close when an option is selected', async () => {
      const user = userEvent.setup()
      const onSelectMetadata = vi.fn()
      renderDatasetMetadataPicker({ onSelectMetadata })

      await user.click(screen.getByRole('button', { name: 'dataset.metadata.addMetadata' }))
      await user.click(await screen.findByRole('option', { name: /field_two/ }))

      expect(onSelectMetadata).toHaveBeenCalledWith({
        id: '2',
        name: 'field_two',
        type: DataType.number,
      })
      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: 'dataset.metadata.addMetadata' }),
        ).toHaveAttribute('aria-expanded', 'false')
      })
    })
  })

  describe('Actions', () => {
    it('should keep footer actions interactive until their click completes', async () => {
      const user = userEvent.setup()
      const onOpenMetadataManagement = vi.fn()
      renderDatasetMetadataPicker({ onOpenMetadataManagement })

      const trigger = screen.getByRole('button', { name: 'dataset.metadata.addMetadata' })
      await user.click(trigger)
      const manageButton = screen.getByRole('button', {
        name: 'dataset.metadata.selectMetadata.manageAction',
      })

      await user.pointer({ keys: '[MouseLeft>]', target: manageButton })

      expect(trigger).toHaveAttribute('aria-expanded', 'true')
      expect(onOpenMetadataManagement).not.toHaveBeenCalled()

      await user.pointer({ keys: '[/MouseLeft]', target: manageButton })

      expect(onOpenMetadataManagement).toHaveBeenCalledOnce()
      await waitFor(() => {
        expect(trigger).toHaveAttribute('aria-expanded', 'false')
      })
    })

    it('should switch to create view and save a new metadata item', async () => {
      const user = userEvent.setup()
      const onCreateMetadata = vi.fn().mockResolvedValue(undefined)
      renderDatasetMetadataPicker({ onCreateMetadata })

      await user.click(screen.getByRole('button', { name: 'dataset.metadata.addMetadata' }))
      await user.click(
        screen.getByRole('button', { name: 'dataset.metadata.selectMetadata.newAction' }),
      )
      await user.click(screen.getByRole('radio', { name: 'Number' }))
      await user.type(
        screen.getByRole('textbox', { name: 'dataset.metadata.createMetadata.name' }),
        'new_field',
      )
      await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

      expect(onCreateMetadata).toHaveBeenCalledWith({
        name: 'new_field',
        type: DataType.number,
      })
      await waitFor(() => {
        expect(
          screen.getByRole('combobox', { name: 'dataset.metadata.selectMetadata.search' }),
        ).toBeInTheDocument()
      })
    })

    it('should return from create view without closing the picker', async () => {
      const user = userEvent.setup()
      renderDatasetMetadataPicker()

      await user.click(screen.getByRole('button', { name: 'dataset.metadata.addMetadata' }))
      await user.click(
        screen.getByRole('button', { name: 'dataset.metadata.selectMetadata.newAction' }),
      )
      await user.click(screen.getByRole('button', { name: 'dataset.metadata.createMetadata.back' }))

      expect(
        screen.getByRole('combobox', { name: 'dataset.metadata.selectMetadata.search' }),
      ).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'dataset.metadata.addMetadata' })).toHaveAttribute(
        'aria-expanded',
        'true',
      )
    })
  })

  describe('Edge Cases', () => {
    it('should keep action buttons available when metadata list is empty', async () => {
      const user = userEvent.setup()
      mockDatasetMetadataQuery.mockResolvedValue({ doc_metadata: [] })

      renderDatasetMetadataPicker()

      await user.click(screen.getByRole('button', { name: 'dataset.metadata.addMetadata' }))

      expect(await screen.findByRole('status')).toHaveTextContent('common.noData')
      expect(
        screen.getByRole('button', { name: 'dataset.metadata.selectMetadata.newAction' }),
      ).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: 'dataset.metadata.selectMetadata.manageAction' }),
      ).toBeInTheDocument()
      expect(screen.getByRole('listbox')).not.toContainElement(
        screen.getByRole('button', { name: 'dataset.metadata.selectMetadata.newAction' }),
      )
    })
  })
})
