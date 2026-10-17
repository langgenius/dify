import type { PreProcessingRule } from '@dify/contracts/api/console/datasets/types.gen'
import type { ParentChildConfig } from '../../hooks'
import { RadioGroup } from '@langgenius/dify-ui/radio-group'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { ChunkingMode } from '@/models/datasets'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { ParentChildOptions } from '../parent-child-options'

const ns = 'datasetCreation'
const render = (ui: React.ReactElement) =>
  renderWithConsoleQuery(<RadioGroup aria-label="Chunking mode">{ui}</RadioGroup>, {
    systemFeatures: { deployment_edition: 'COMMUNITY' },
  })

const createRules = (): PreProcessingRule[] => [
  { id: 'remove_extra_spaces', enabled: true },
  { id: 'remove_urls_emails', enabled: false },
]

const createParentChildConfig = (overrides?: Partial<ParentChildConfig>): ParentChildConfig => ({
  chunkForContext: 'paragraph',
  parent: { delimiter: '\\n\\n', maxLength: 2000 },
  child: { delimiter: '\\n', maxLength: 500 },
  ...overrides,
})

const defaultProps = {
  parentChildConfig: createParentChildConfig(),
  rules: createRules(),
  currentDocForm: ChunkingMode.parentChild,
  isActive: true,
  isInUpload: false,
  isNotUploadInEmptyDataset: false,
  onChunkForContextChange: vi.fn(),
  onParentDelimiterChange: vi.fn(),
  onParentMaxLengthChange: vi.fn(),
  onChildDelimiterChange: vi.fn(),
  onChildMaxLengthChange: vi.fn(),
  onRuleToggle: vi.fn(),
  onPreview: vi.fn(),
  onReset: vi.fn(),
}

describe('ParentChildOptions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should not render body when not active', () => {
      render(<ParentChildOptions {...defaultProps} isActive={false} />)
      expect(screen.queryByText(`${ns}.stepTwo.parentChunkForContext`)).not.toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should call onPreview when preview button clicked', async () => {
      const user = userEvent.setup()
      const onPreview = vi.fn()
      render(<ParentChildOptions {...defaultProps} onPreview={onPreview} />)
      await user.click(screen.getByText(`${ns}.stepTwo.previewChunk`))
      expect(onPreview).toHaveBeenCalledOnce()
    })

    it('should call onReset when reset button clicked', async () => {
      const user = userEvent.setup()
      const onReset = vi.fn()
      render(<ParentChildOptions {...defaultProps} onReset={onReset} />)
      await user.click(screen.getByText(`${ns}.stepTwo.reset`))
      expect(onReset).toHaveBeenCalledOnce()
    })

    it('should call onRuleToggle when rule clicked', async () => {
      const user = userEvent.setup()
      const onRuleToggle = vi.fn()
      render(<ParentChildOptions {...defaultProps} onRuleToggle={onRuleToggle} />)
      await user.click(screen.getByText(`${ns}.stepTwo.removeUrlEmails`))
      expect(onRuleToggle).toHaveBeenCalledWith('remove_urls_emails')
    })

    it('should call onChunkForContextChange when full-doc chosen', async () => {
      const user = userEvent.setup()
      const onChunkForContextChange = vi.fn()
      render(
        <ParentChildOptions {...defaultProps} onChunkForContextChange={onChunkForContextChange} />,
      )
      await user.click(screen.getByText(`${ns}.stepTwo.fullDoc`))
      expect(onChunkForContextChange).toHaveBeenCalledWith('full-doc')
    })

    it('should call onChunkForContextChange when paragraph chosen', async () => {
      const user = userEvent.setup()
      const onChunkForContextChange = vi.fn()
      const config = createParentChildConfig({ chunkForContext: 'full-doc' })
      render(
        <ParentChildOptions
          {...defaultProps}
          parentChildConfig={config}
          onChunkForContextChange={onChunkForContextChange}
        />,
      )
      await user.click(screen.getByText(`${ns}.stepTwo.paragraph`))
      expect(onChunkForContextChange).toHaveBeenCalledWith('paragraph')
    })
  })
})
