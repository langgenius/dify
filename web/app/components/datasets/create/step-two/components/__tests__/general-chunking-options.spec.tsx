import type { PreProcessingRule } from '@/models/datasets'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ChunkingMode } from '@/models/datasets'
import { GeneralChunkingOptions } from '../general-chunking-options'

vi.mock('@/app/components/datasets/settings/summary-index-setting', () => ({
  default: ({ onSummaryIndexSettingChange }: { onSummaryIndexSettingChange?: (val: Record<string, unknown>) => void }) => (
    <div data-testid="summary-index-setting">
      <button data-testid="summary-toggle" onClick={() => onSummaryIndexSettingChange?.({ enable: true })}>Toggle</button>
    </div>
  ),
}))

vi.mock('@/config', () => ({
  IS_CE_EDITION: true,
}))

const ns = 'datasetCreation'

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
    it('should render general chunking title', () => {
      render(<GeneralChunkingOptions {...defaultProps} />)
      expect(screen.getByText(`${ns}.stepTwo.general`)).toBeInTheDocument()
    })

    it('should render delimiter, max length and overlap inputs when active', () => {
      render(<GeneralChunkingOptions {...defaultProps} />)
      expect(screen.getByText(`${ns}.stepTwo.separator`)).toBeInTheDocument()
      expect(screen.getByText(`${ns}.stepTwo.maxLength`)).toBeInTheDocument()
      expect(screen.getAllByText(new RegExp(`${ns}.stepTwo.overlap`)).length).toBeGreaterThan(0)
    })

    it('should render preprocessing rules as checkboxes', () => {
      render(<GeneralChunkingOptions {...defaultProps} />)
      expect(screen.getByText(`${ns}.stepTwo.removeExtraSpaces`)).toBeInTheDocument()
      expect(screen.getByText(`${ns}.stepTwo.removeUrlEmails`)).toBeInTheDocument()
    })

    it('should render preview and reset buttons when active', () => {
      render(<GeneralChunkingOptions {...defaultProps} />)
      expect(screen.getByText(`${ns}.stepTwo.previewChunk`)).toBeInTheDocument()
      expect(screen.getByText(`${ns}.stepTwo.reset`)).toBeInTheDocument()
    })

    it('should not render body when not active', () => {
      render(<GeneralChunkingOptions {...defaultProps} isActive={false} />)
      expect(screen.queryByText(`${ns}.stepTwo.separator`)).not.toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should call onPreview when preview button clicked', () => {
      const onPreview = vi.fn()
      render(<GeneralChunkingOptions {...defaultProps} onPreview={onPreview} />)
      fireEvent.click(screen.getByText(`${ns}.stepTwo.previewChunk`))
      expect(onPreview).toHaveBeenCalledOnce()
    })

    it('should call onReset when reset button clicked', () => {
      const onReset = vi.fn()
      render(<GeneralChunkingOptions {...defaultProps} onReset={onReset} />)
      fireEvent.click(screen.getByText(`${ns}.stepTwo.reset`))
      expect(onReset).toHaveBeenCalledOnce()
    })

    it('should call onRuleToggle when rule clicked', () => {
      const onRuleToggle = vi.fn()
      render(<GeneralChunkingOptions {...defaultProps} onRuleToggle={onRuleToggle} />)
      fireEvent.click(screen.getByText(`${ns}.stepTwo.removeUrlEmails`))
      expect(onRuleToggle).toHaveBeenCalledWith('remove_urls_emails')
    })

    it('should call onDocFormChange with text mode when card switched', () => {
      const onDocFormChange = vi.fn()
      render(<GeneralChunkingOptions {...defaultProps} isActive={false} onDocFormChange={onDocFormChange} />)
      // OptionCard fires onSwitched which calls onDocFormChange(ChunkingMode.text)
      // Since isActive=false, clicking the card triggers the switch
      const titleEl = screen.getByText(`${ns}.stepTwo.general`)
      fireEvent.click(titleEl.closest('[class*="rounded-xl"]')!)
      expect(onDocFormChange).toHaveBeenCalledWith(ChunkingMode.text)
    })
  })

  describe('QA Mode (CE Edition)', () => {
    it('should render QA language checkbox', () => {
      render(<GeneralChunkingOptions {...defaultProps} />)
      expect(screen.getByText(`${ns}.stepTwo.useQALanguage`)).toBeInTheDocument()
    })

    it('should toggle QA mode when checkbox clicked', () => {
      const onDocFormChange = vi.fn()
      render(<GeneralChunkingOptions {...defaultProps} onDocFormChange={onDocFormChange} />)
      fireEvent.click(screen.getByText(`${ns}.stepTwo.useQALanguage`))
      expect(onDocFormChange).toHaveBeenCalledWith(ChunkingMode.qa)
    })

    it('should toggle back to text mode from QA mode', () => {
      const onDocFormChange = vi.fn()
      render(<GeneralChunkingOptions {...defaultProps} currentDocForm={ChunkingMode.qa} onDocFormChange={onDocFormChange} />)
      fireEvent.click(screen.getByText(`${ns}.stepTwo.useQALanguage`))
      expect(onDocFormChange).toHaveBeenCalledWith(ChunkingMode.text)
    })

    it('should not toggle QA mode when hasCurrentDatasetDocForm is true', () => {
      const onDocFormChange = vi.fn()
      render(<GeneralChunkingOptions {...defaultProps} hasCurrentDatasetDocForm onDocFormChange={onDocFormChange} />)
      fireEvent.click(screen.getByText(`${ns}.stepTwo.useQALanguage`))
      expect(onDocFormChange).not.toHaveBeenCalled()
    })

    it('should show QA warning tip when in QA mode', () => {
      render(<GeneralChunkingOptions {...defaultProps} currentDocForm={ChunkingMode.qa} />)
      expect(screen.getAllByText(`${ns}.stepTwo.QATip`).length).toBeGreaterThan(0)
    })
  })

  describe('Summary Index Setting', () => {
    it('should render SummaryIndexSetting when showSummaryIndexSetting is true', () => {
      render(<GeneralChunkingOptions {...defaultProps} showSummaryIndexSetting />)
      expect(screen.getByTestId('summary-index-setting')).toBeInTheDocument()
    })

    it('should not render SummaryIndexSetting when showSummaryIndexSetting is false', () => {
      render(<GeneralChunkingOptions {...defaultProps} showSummaryIndexSetting={false} />)
      expect(screen.queryByTestId('summary-index-setting')).not.toBeInTheDocument()
    })

    it('should call onSummaryIndexSettingChange', () => {
      const onSummaryIndexSettingChange = vi.fn()
      render(<GeneralChunkingOptions {...defaultProps} showSummaryIndexSetting onSummaryIndexSettingChange={onSummaryIndexSettingChange} />)
      fireEvent.click(screen.getByTestId('summary-toggle'))
      expect(onSummaryIndexSettingChange).toHaveBeenCalledWith({ enable: true })
    })
  })
})
