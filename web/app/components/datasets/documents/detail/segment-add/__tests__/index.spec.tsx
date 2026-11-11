import type { CloudPlan } from '@dify/contracts/api/console/features/types.gen'
import type { ReactElement } from 'react'
import type { SegmentImportStatus } from '@/types/dataset'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { render as renderWithConsoleState } from '@/test/console/render'
import { segmentImportStatus } from '@/types/dataset'
import { SegmentAdd } from '../index'

// Mock provider context
let mockPlan: { type: CloudPlan } = { type: 'professional' }
let deploymentEdition: 'CLOUD' | 'COMMUNITY' = 'CLOUD'

function render(ui: ReactElement) {
  const { wrapper: QueryWrapper } = createConsoleQueryWrapper({
    systemFeatures: { deployment_edition: deploymentEdition },
    features: { billing: { subscription: { plan: mockPlan.type } } },
  })
  return renderWithConsoleState(ui, {
    wrapper: ({ children }) => (
      <NuqsTestingAdapter>
        <QueryWrapper>{children}</QueryWrapper>
      </NuqsTestingAdapter>
    ),
  })
}

describe('SegmentAdd', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPlan = { type: 'professional' }
    deploymentEdition = 'CLOUD'
  })

  const defaultProps = {
    importStatus: undefined as SegmentImportStatus | undefined,
    clearImportStatus: vi.fn(),
    showNewSegmentModal: vi.fn(),
    showBatchModal: vi.fn(),
    embedding: false,
  }

  it.each([segmentImportStatus.waiting, segmentImportStatus.processing])(
    'withholds add actions while import is %s',
    (importStatus) => {
      render(<SegmentAdd {...defaultProps} importStatus={importStatus} />)
      expect(screen.getByText('datasetDocuments.list.batchModal.processing')).toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'datasetDocuments.list.action.addButton' }),
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'datasetDocuments.list.action.batchAdd' }),
      ).not.toBeInTheDocument()
    },
  )

  it.each([segmentImportStatus.completed, segmentImportStatus.error])(
    'allows acknowledgement of %s imports',
    async (importStatus) => {
      const user = userEvent.setup()
      render(<SegmentAdd {...defaultProps} importStatus={importStatus} />)
      expect(
        screen.getByText(`datasetDocuments.list.batchModal.${importStatus}`),
      ).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'datasetDocuments.list.batchModal.ok' }))
      expect(defaultProps.clearImportStatus).toHaveBeenCalledOnce()
    },
  )

  it('opens single and batch import for paid users', async () => {
    const user = userEvent.setup()
    render(<SegmentAdd {...defaultProps} />)
    await user.click(screen.getByRole('button', { name: 'datasetDocuments.list.action.addButton' }))
    expect(defaultProps.showNewSegmentModal).toHaveBeenCalledOnce()
    await user.click(screen.getByRole('button', { name: 'datasetDocuments.list.action.batchAdd' }))
    await user.click(
      await screen.findByRole('menuitem', { name: 'datasetDocuments.list.action.batchAdd' }),
    )
    expect(defaultProps.showBatchModal).toHaveBeenCalledOnce()
  })

  it('blocks both add actions while embedding', async () => {
    const user = userEvent.setup()
    render(<SegmentAdd {...defaultProps} embedding />)
    for (const name of ['addButton', 'batchAdd']) {
      const button = screen.getByRole('button', { name: `datasetDocuments.list.action.${name}` })
      expect(button).toBeDisabled()
      await user.click(button)
    }
    expect(defaultProps.showNewSegmentModal).not.toHaveBeenCalled()
    expect(defaultProps.showBatchModal).not.toHaveBeenCalled()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it.each(['single', 'batch'])(
    'offers an upgrade instead of %s import on sandbox',
    async (mode) => {
      const user = userEvent.setup()
      mockPlan = { type: 'sandbox' }
      render(<SegmentAdd {...defaultProps} />)
      if (mode === 'single')
        await user.click(
          screen.getByRole('button', { name: 'datasetDocuments.list.action.addButton' }),
        )
      else {
        await user.click(
          screen.getByRole('button', { name: 'datasetDocuments.list.action.batchAdd' }),
        )
        await user.click(
          await screen.findByRole('menuitem', { name: 'datasetDocuments.list.action.batchAdd' }),
        )
      }
      expect(await screen.findByRole('dialog')).toBeInTheDocument()
      expect(defaultProps.showNewSegmentModal).not.toHaveBeenCalled()
      expect(defaultProps.showBatchModal).not.toHaveBeenCalled()
      await user.click(screen.getByRole('button', { name: 'billing.triggerLimitModal.dismiss' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    },
  )

  it('allows community import independently of the cloud plan', async () => {
    const user = userEvent.setup()
    mockPlan = { type: 'sandbox' }
    deploymentEdition = 'COMMUNITY'
    render(<SegmentAdd {...defaultProps} />)
    await user.click(screen.getByRole('button', { name: 'datasetDocuments.list.action.addButton' }))
    expect(defaultProps.showNewSegmentModal).toHaveBeenCalledOnce()
  })
})
