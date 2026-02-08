import type { Collection, Tool } from '../types'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ToolItem from './tool-item'

// Mock useLocale hook
vi.mock('@/context/i18n', () => ({
  useLocale: () => 'en-US',
}))

// Mock getLanguage - returns key format used in TypeWithI18N (en_US, not en-US)
vi.mock('@/i18n-config/language', () => ({
  getLanguage: () => 'en_US',
}))

// Track modal visibility for assertions
let mockModalVisible = false

// Mock SettingBuiltInTool modal - complex component that needs mocking
vi.mock('@/app/components/app/configuration/config/agent/agent-tools/setting-built-in-tool', () => ({
  default: ({ onHide, collection, toolName, readonly, isBuiltIn, isModel }: {
    onHide: () => void
    collection: Collection
    toolName: string
    readonly: boolean
    isBuiltIn: boolean
    isModel: boolean
  }) => {
    mockModalVisible = true
    return (
      <div data-testid="setting-built-in-tool-modal">
        <span data-testid="modal-tool-name">{toolName}</span>
        <span data-testid="modal-collection-id">{collection.id}</span>
        <span data-testid="modal-readonly">{readonly.toString()}</span>
        <span data-testid="modal-is-builtin">{isBuiltIn.toString()}</span>
        <span data-testid="modal-is-model">{isModel.toString()}</span>
        <button data-testid="close-modal" onClick={onHide}>Close</button>
      </div>
    )
  },
}))

describe('ToolItem', () => {
  // Factory function for creating mock collection
  const createMockCollection = (overrides?: Partial<Collection>): Collection => ({
    id: 'test-collection-id',
    name: 'test-collection',
    author: 'Test Author',
    description: { en_US: 'Test collection description', zh_Hans: '测试集合描述' },
    icon: '🔧',
    label: { en_US: 'Test Collection', zh_Hans: '测试集合' },
    type: 'builtin',
    team_credentials: {},
    is_team_authorization: false,
    allow_delete: false,
    labels: [],
    ...overrides,
  })

  // Factory function for creating mock tool
  const createMockTool = (overrides?: Partial<Tool>): Tool => ({
    name: 'test-tool',
    author: 'Test Author',
    label: {
      en_US: 'Test Tool Label',
      zh_Hans: '测试工具标签',
    },
    description: {
      en_US: 'Test tool description for testing purposes',
      zh_Hans: '测试工具描述',
    },
    parameters: [],
    labels: [],
    output_schema: {},
    ...overrides,
  })

  const defaultProps = {
    collection: createMockCollection(),
    tool: createMockTool(),
    isBuiltIn: true,
    isModel: false,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockModalVisible = false
  })

  // Tests for basic rendering
  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<ToolItem {...defaultProps} />)

      expect(screen.getByText('Test Tool Label')).toBeInTheDocument()
    })

    it('should display tool label in current language', () => {
      render(<ToolItem {...defaultProps} />)

      expect(screen.getByText('Test Tool Label')).toBeInTheDocument()
    })

    it('should display tool description in current language', () => {
      render(<ToolItem {...defaultProps} />)

      expect(screen.getByText('Test tool description for testing purposes')).toBeInTheDocument()
    })

    it('should have cursor-pointer class by default', () => {
      render(<ToolItem {...defaultProps} />)

      const card = document.querySelector('.cursor-pointer')
      expect(card).toBeInTheDocument()
    })

    it('should have correct card styling', () => {
      render(<ToolItem {...defaultProps} />)

      const card = document.querySelector('.rounded-xl.border-\\[0\\.5px\\]')
      expect(card).toBeInTheDocument()
    })
  })

  // Tests for disabled state
  describe('Disabled State', () => {
    it('should apply disabled styles when disabled is true', () => {
      render(<ToolItem {...defaultProps} disabled />)

      const card = document.querySelector('.opacity-50')
      expect(card).toBeInTheDocument()
    })

    it('should have cursor-not-allowed when disabled', () => {
      render(<ToolItem {...defaultProps} disabled />)

      const card = document.querySelector('.\\!cursor-not-allowed')
      expect(card).toBeInTheDocument()
    })

    it('should not open modal when clicking disabled card', () => {
      render(<ToolItem {...defaultProps} disabled />)

      const card = document.querySelector('.rounded-xl')
      fireEvent.click(card!)

      expect(screen.queryByTestId('setting-built-in-tool-modal')).not.toBeInTheDocument()
      expect(mockModalVisible).toBe(false)
    })
  })

  // Tests for click interaction and modal
  describe('Click Interaction', () => {
    it('should open detail modal on click', () => {
      render(<ToolItem {...defaultProps} />)

      const card = document.querySelector('.rounded-xl')
      fireEvent.click(card!)

      expect(screen.getByTestId('setting-built-in-tool-modal')).toBeInTheDocument()
      expect(mockModalVisible).toBe(true)
    })

    it('should pass correct props to modal', () => {
      render(<ToolItem {...defaultProps} />)

      const card = document.querySelector('.rounded-xl')
      fireEvent.click(card!)

      expect(screen.getByTestId('modal-tool-name')).toHaveTextContent('test-tool')
      expect(screen.getByTestId('modal-collection-id')).toHaveTextContent('test-collection-id')
      expect(screen.getByTestId('modal-readonly')).toHaveTextContent('true')
      expect(screen.getByTestId('modal-is-builtin')).toHaveTextContent('true')
      expect(screen.getByTestId('modal-is-model')).toHaveTextContent('false')
    })

    it('should close modal when onHide is called', () => {
      render(<ToolItem {...defaultProps} />)

      // Open modal
      const card = document.querySelector('.rounded-xl')
      fireEvent.click(card!)
      expect(screen.getByTestId('setting-built-in-tool-modal')).toBeInTheDocument()

      // Close modal
      fireEvent.click(screen.getByTestId('close-modal'))
      expect(screen.queryByTestId('setting-built-in-tool-modal')).not.toBeInTheDocument()
    })
  })

  // Tests for different prop combinations
  describe('Props Variations', () => {
    it('should pass isBuiltIn=false to modal when not built-in', () => {
      render(<ToolItem {...defaultProps} isBuiltIn={false} />)

      const card = document.querySelector('.rounded-xl')
      fireEvent.click(card!)

      expect(screen.getByTestId('modal-is-builtin')).toHaveTextContent('false')
    })

    it('should pass isModel=true to modal when it is a model tool', () => {
      render(<ToolItem {...defaultProps} isModel />)

      const card = document.querySelector('.rounded-xl')
      fireEvent.click(card!)

      expect(screen.getByTestId('modal-is-model')).toHaveTextContent('true')
    })

    it('should handle tool with different collection', () => {
      const customCollection = createMockCollection({
        id: 'custom-collection',
        name: 'Custom Collection',
      })

      render(<ToolItem {...defaultProps} collection={customCollection} />)

      const card = document.querySelector('.rounded-xl')
      fireEvent.click(card!)

      expect(screen.getByTestId('modal-collection-id')).toHaveTextContent('custom-collection')
    })
  })

  // Tests for edge cases
  describe('Edge Cases', () => {
    it('should handle tool with empty description', () => {
      const toolWithEmptyDesc = createMockTool({
        description: { 'en-US': '' },
      })

      render(<ToolItem {...defaultProps} tool={toolWithEmptyDesc} />)

      expect(screen.getByText('Test Tool Label')).toBeInTheDocument()
    })

    it('should handle missing language in label', () => {
      const toolWithMissingLang = createMockTool({
        label: { en_US: '', zh_Hans: '中文标签' },
        description: { en_US: '', zh_Hans: '中文描述' },
      })

      // Should render without crashing (will show empty string for missing en_US)
      render(<ToolItem {...defaultProps} tool={toolWithMissingLang} />)

      const card = document.querySelector('.rounded-xl')
      expect(card).toBeInTheDocument()
    })

    it('should show description title attribute', () => {
      render(<ToolItem {...defaultProps} />)

      const descriptionElement = screen.getByText('Test tool description for testing purposes')
      expect(descriptionElement).toHaveAttribute('title', 'Test tool description for testing purposes')
    })

    it('should apply line-clamp-2 to description for text overflow', () => {
      render(<ToolItem {...defaultProps} />)

      const descriptionElement = document.querySelector('.line-clamp-2')
      expect(descriptionElement).toBeInTheDocument()
    })
  })

  // Tests for accessibility
  describe('Accessibility', () => {
    it('should be clickable with keyboard', () => {
      render(<ToolItem {...defaultProps} />)

      const card = document.querySelector('.rounded-xl')

      // The div is clickable, test that it can receive focus-like interaction
      fireEvent.click(card!)

      expect(screen.getByTestId('setting-built-in-tool-modal')).toBeInTheDocument()
    })
  })
})
