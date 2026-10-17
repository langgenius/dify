import type { PreProcessingRule } from '@dify/contracts/api/console/datasets/types.gen'
import { RadioGroup } from '@langgenius/dify-ui/radio-group'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { ChunkingMode } from '@/models/datasets'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { GeneralChunkingOptions } from '../general-chunking-options'

const ns = 'datasetCreation'
const render = (ui: React.ReactElement) =>
  renderWithConsoleQuery(<RadioGroup aria-label="Chunking mode">{ui}</RadioGroup>, {
    systemFeatures: { deployment_edition: 'COMMUNITY' },
  })

const createRules = (): PreProcessingRule[] => [
  { id: 'remove_extra_spaces', enabled: true },
  { id: 'remove_urls_emails', enabled: false },
]

const defaultProps = {
  segmentIdentifier: '\\n',
  maxChunkLength: 500,
  overlap: 50,
  rules: createRules(),
  currentDocForm: ChunkingMode.text,
  docLanguage: 'English',
  isActive: true,
  isInUpload: false,
  isNotUploadInEmptyDataset: false,
  hasCurrentDatasetDocForm: false,
  onSegmentIdentifierChange: vi.fn(),
  onMaxChunkLengthChange: vi.fn(),
  onOverlapChange: vi.fn(),
  onRuleToggle: vi.fn(),
  onDocFormChange: vi.fn(),
  onDocLanguageChange: vi.fn(),
  onPreview: vi.fn(),
  onReset: vi.fn(),
  locale: 'en',
}

describe('GeneralChunkingOptions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should not render body when not active', () => {
      render(<GeneralChunkingOptions {...defaultProps} isActive={false} />)
      expect(screen.queryByText(`${ns}.stepTwo.separator`)).not.toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should call onPreview when preview button clicked', async () => {
      const user = userEvent.setup()
      const onPreview = vi.fn()
      render(<GeneralChunkingOptions {...defaultProps} onPreview={onPreview} />)
      await user.click(screen.getByText(`${ns}.stepTwo.previewChunk`))
      expect(onPreview).toHaveBeenCalledOnce()
    })

    it('should call onReset when reset button clicked', async () => {
      const user = userEvent.setup()
      const onReset = vi.fn()
      render(<GeneralChunkingOptions {...defaultProps} onReset={onReset} />)
      await user.click(screen.getByText(`${ns}.stepTwo.reset`))
      expect(onReset).toHaveBeenCalledOnce()
    })

    it('should call onRuleToggle when rule clicked', async () => {
      const user = userEvent.setup()
      const onRuleToggle = vi.fn()
      render(<GeneralChunkingOptions {...defaultProps} onRuleToggle={onRuleToggle} />)
      await user.click(screen.getByText(`${ns}.stepTwo.removeUrlEmails`))
      expect(onRuleToggle).toHaveBeenCalledWith('remove_urls_emails')
    })
  })

  describe('QA Mode (CE Edition)', () => {
    it('should toggle QA mode when checkbox clicked', async () => {
      const user = userEvent.setup()
      const onDocFormChange = vi.fn()
      render(<GeneralChunkingOptions {...defaultProps} onDocFormChange={onDocFormChange} />)
      await user.click(screen.getByText(`${ns}.stepTwo.useQALanguage`))
      expect(onDocFormChange).toHaveBeenCalledWith(ChunkingMode.qa)
    })

    it('should toggle back to text mode from QA mode', async () => {
      const user = userEvent.setup()
      const onDocFormChange = vi.fn()
      render(
        <GeneralChunkingOptions
          {...defaultProps}
          currentDocForm={ChunkingMode.qa}
          onDocFormChange={onDocFormChange}
        />,
      )
      await user.click(screen.getByText(`${ns}.stepTwo.useQALanguage`))
      expect(onDocFormChange).toHaveBeenCalledWith(ChunkingMode.text)
    })

    it('should not toggle QA mode when hasCurrentDatasetDocForm is true', async () => {
      const user = userEvent.setup()
      const onDocFormChange = vi.fn()
      render(
        <GeneralChunkingOptions
          {...defaultProps}
          hasCurrentDatasetDocForm
          onDocFormChange={onDocFormChange}
        />,
      )
      await user.click(screen.getByText(`${ns}.stepTwo.useQALanguage`))
      expect(onDocFormChange).not.toHaveBeenCalled()
    })

    it('should show QA warning tip when in QA mode', () => {
      render(<GeneralChunkingOptions {...defaultProps} currentDocForm={ChunkingMode.qa} />)
      expect(screen.getAllByText(`${ns}.stepTwo.QATip`).length).toBeGreaterThan(0)
    })
  })
})
