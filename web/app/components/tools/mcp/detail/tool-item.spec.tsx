import type { Tool } from '@/app/components/tools/types'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import MCPToolItem from './tool-item'

describe('MCPToolItem', () => {
  const createMockTool = (overrides = {}): Tool => ({
    name: 'test-tool',
    label: {
      en_US: 'Test Tool',
      zh_Hans: '测试工具',
    },
    description: {
      en_US: 'A test tool description',
      zh_Hans: '测试工具描述',
    },
    parameters: [],
    ...overrides,
  } as unknown as Tool)

  describe('Rendering', () => {
    it('should render without crashing', () => {
      const tool = createMockTool()
      render(<MCPToolItem tool={tool} />)
      expect(screen.getByText('Test Tool')).toBeInTheDocument()
    })

    it('should display tool label', () => {
      const tool = createMockTool()
      render(<MCPToolItem tool={tool} />)
      expect(screen.getByText('Test Tool')).toBeInTheDocument()
    })

    it('should display tool description', () => {
      const tool = createMockTool()
      render(<MCPToolItem tool={tool} />)
      expect(screen.getByText('A test tool description')).toBeInTheDocument()
    })
  })

  describe('With Parameters', () => {
    it('should not show parameters section when no parameters', () => {
      const tool = createMockTool({ parameters: [] })
      render(<MCPToolItem tool={tool} />)
      expect(screen.queryByText('tools.mcp.toolItem.parameters')).not.toBeInTheDocument()
    })

    it('should render with parameters', () => {
      const tool = createMockTool({
        parameters: [
          {
            name: 'param1',
            type: 'string',
            human_description: {
              en_US: 'A parameter description',
            },
          },
        ],
      })
      render(<MCPToolItem tool={tool} />)
      // Tooltip content is rendered in portal, may not be visible immediately
      expect(screen.getByText('Test Tool')).toBeInTheDocument()
    })
  })

  describe('Styling', () => {
    it('should have cursor-pointer class', () => {
      const tool = createMockTool()
      render(<MCPToolItem tool={tool} />)
      const toolElement = document.querySelector('.cursor-pointer')
      expect(toolElement).toBeInTheDocument()
    })

    it('should have rounded-xl class', () => {
      const tool = createMockTool()
      render(<MCPToolItem tool={tool} />)
      const toolElement = document.querySelector('.rounded-xl')
      expect(toolElement).toBeInTheDocument()
    })

    it('should have hover styles', () => {
      const tool = createMockTool()
      render(<MCPToolItem tool={tool} />)
      const toolElement = document.querySelector('[class*="hover:bg-components-panel-on-panel-item-bg-hover"]')
      expect(toolElement).toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty label', () => {
      const tool = createMockTool({
        label: { en_US: '', zh_Hans: '' },
      })
      render(<MCPToolItem tool={tool} />)
      // Should render without crashing
      expect(document.querySelector('.cursor-pointer')).toBeInTheDocument()
    })

    it('should handle empty description', () => {
      const tool = createMockTool({
        description: { en_US: '', zh_Hans: '' },
      })
      render(<MCPToolItem tool={tool} />)
      expect(screen.getByText('Test Tool')).toBeInTheDocument()
    })

    it('should handle long description with line clamp', () => {
      const longDescription = 'This is a very long description '.repeat(20)
      const tool = createMockTool({
        description: { en_US: longDescription, zh_Hans: longDescription },
      })
      render(<MCPToolItem tool={tool} />)
      const descElement = document.querySelector('.line-clamp-2')
      expect(descElement).toBeInTheDocument()
    })

    it('should handle special characters in tool name', () => {
      const tool = createMockTool({
        name: 'special-tool_v2.0',
        label: { en_US: 'Special Tool <v2.0>', zh_Hans: '特殊工具' },
      })
      render(<MCPToolItem tool={tool} />)
      expect(screen.getByText('Special Tool <v2.0>')).toBeInTheDocument()
    })
  })
})
