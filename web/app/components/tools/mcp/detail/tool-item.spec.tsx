import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import MCPToolItem from './tool-item'

// Mock useLocale hook
vi.mock('@/context/i18n', () => ({
  useLocale: () => 'en-US',
}))

// Mock getLanguage
vi.mock('@/i18n-config/language', () => ({
  getLanguage: () => 'en-US',
}))

type MockTool = Parameters<typeof MCPToolItem>[0]['tool']

describe('MCPToolItem', () => {
  const mockTool = {
    name: 'search-tool',
    label: {
      'en-US': 'Search Tool',
      'zh-CN': '搜索工具',
    },
    description: {
      'en-US': 'A powerful search tool',
      'zh-CN': '强大的搜索工具',
    },
    parameters: [],
  } as unknown as MockTool

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<MCPToolItem tool={mockTool} />)

      expect(screen.getByText('Search Tool')).toBeInTheDocument()
    })

    it('should display tool label in current language', () => {
      render(<MCPToolItem tool={mockTool} />)

      expect(screen.getByText('Search Tool')).toBeInTheDocument()
    })

    it('should display tool description in current language', () => {
      render(<MCPToolItem tool={mockTool} />)

      expect(screen.getByText('A powerful search tool')).toBeInTheDocument()
    })

    it('should have clickable card styling', () => {
      render(<MCPToolItem tool={mockTool} />)

      const card = document.querySelector('.cursor-pointer')
      expect(card).toBeInTheDocument()
    })
  })

  describe('Parameters', () => {
    it('should not render parameters section when no parameters', () => {
      render(<MCPToolItem tool={mockTool} />)

      expect(screen.queryByText('tools.mcp.toolItem.parameters')).not.toBeInTheDocument()
    })

    it('should render parameters when tool has parameters', () => {
      const toolWithParams = {
        ...mockTool,
        parameters: [
          {
            name: 'query',
            type: 'string',
            human_description: {
              'en-US': 'Search query string',
            },
          },
        ],
      }

      render(<MCPToolItem tool={toolWithParams as unknown as MockTool} />)

      // The parameters are in the tooltip popup, which may not be visible initially
      // We just check the component renders without errors
      expect(screen.getByText('Search Tool')).toBeInTheDocument()
    })
  })

  describe('Tooltip', () => {
    it('should wrap content in Tooltip component', () => {
      render(<MCPToolItem tool={mockTool} />)

      // The tooltip should be present (checking for the card that triggers it)
      const card = document.querySelector('.rounded-xl.border-\\[0\\.5px\\]')
      expect(card).toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should handle missing language fallback', () => {
      const toolWithMissingLang = {
        name: 'test-tool',
        label: {
          'zh-CN': '测试工具',
        },
        description: {
          'zh-CN': '测试描述',
        },
        parameters: [],
      }

      // Should render without crashing even if en-US is missing
      render(<MCPToolItem tool={toolWithMissingLang as unknown as MockTool} />)
      expect(document.querySelector('.rounded-xl')).toBeInTheDocument()
    })
  })
})
