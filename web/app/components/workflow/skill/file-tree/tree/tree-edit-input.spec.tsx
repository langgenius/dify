import type { NodeApi } from 'react-arborist'
import type { TreeNodeData } from '../../type'
import { fireEvent, render, screen } from '@testing-library/react'
import TreeEditInput from './tree-edit-input'

type MockNodeApi = Pick<NodeApi<TreeNodeData>, 'data' | 'reset' | 'submit'>

function createMockNode(overrides: Partial<Pick<TreeNodeData, 'name' | 'node_type'>> = {}): MockNodeApi {
  const nodeType = overrides.node_type ?? 'file'
  return {
    data: {
      id: 'node-1',
      name: overrides.name ?? 'skill.md',
      node_type: nodeType,
      path: `/${overrides.name ?? 'skill.md'}`,
      extension: nodeType === 'folder' ? '' : 'md',
      size: 0,
      children: [],
    },
    reset: vi.fn(),
    submit: vi.fn(),
  }
}

function renderInput(node: MockNodeApi) {
  return render(<TreeEditInput node={node as NodeApi<TreeNodeData>} />)
}

describe('TreeEditInput', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render an input with the node name as default value', () => {
      const node = createMockNode({ name: 'readme.md' })
      renderInput(node)

      const input = screen.getByRole('textbox')
      expect(input).toBeInTheDocument()
      expect(input).toHaveValue('readme.md')
    })

    it('should show file placeholder for file nodes', () => {
      const node = createMockNode({ node_type: 'file' })
      renderInput(node)

      expect(screen.getByPlaceholderText(/fileNamePlaceholder/)).toBeInTheDocument()
    })

    it('should show folder placeholder for folder nodes', () => {
      const node = createMockNode({ node_type: 'folder', name: 'src' })
      renderInput(node)

      expect(screen.getByPlaceholderText(/folderNamePlaceholder/)).toBeInTheDocument()
    })

    it('should have correct aria-label for file nodes', () => {
      const node = createMockNode({ node_type: 'file' })
      renderInput(node)

      expect(screen.getByLabelText(/renameFileInput/)).toBeInTheDocument()
    })

    it('should have correct aria-label for folder nodes', () => {
      const node = createMockNode({ node_type: 'folder', name: 'src' })
      renderInput(node)

      expect(screen.getByLabelText(/renameFolderInput/)).toBeInTheDocument()
    })
  })

  describe('Auto-focus and selection', () => {
    it('should focus the input on mount', () => {
      const node = createMockNode({ name: 'index.ts' })
      renderInput(node)

      expect(screen.getByRole('textbox')).toHaveFocus()
    })

    it('should select only the stem for a file with extension', () => {
      const node = createMockNode({ name: 'skill.md' })
      renderInput(node)

      const input = screen.getByRole('textbox') as HTMLInputElement
      expect(input.selectionStart).toBe(0)
      expect(input.selectionEnd).toBe(5) // "skill" = 5 chars
    })

    it('should select only the last segment for multiple dots', () => {
      const node = createMockNode({ name: 'index.test.ts' })
      renderInput(node)

      const input = screen.getByRole('textbox') as HTMLInputElement
      expect(input.selectionStart).toBe(0)
      expect(input.selectionEnd).toBe(10) // "index.test" = 10 chars
    })

    it('should select all text for a file without extension', () => {
      const node = createMockNode({ name: 'Makefile' })
      renderInput(node)

      const input = screen.getByRole('textbox') as HTMLInputElement
      expect(input.selectionStart).toBe(0)
      expect(input.selectionEnd).toBe(8) // "Makefile" = 8 chars
    })

    it('should select all text for a dotfile', () => {
      const node = createMockNode({ name: '.gitignore' })
      renderInput(node)

      const input = screen.getByRole('textbox') as HTMLInputElement
      expect(input.selectionStart).toBe(0)
      expect(input.selectionEnd).toBe(10) // ".gitignore" = 10, lastIndexOf('.') is 0 which is not > 0
    })

    it('should select all text for a folder', () => {
      const node = createMockNode({ node_type: 'folder', name: 'src.backup' })
      renderInput(node)

      const input = screen.getByRole('textbox') as HTMLInputElement
      expect(input.selectionStart).toBe(0)
      expect(input.selectionEnd).toBe(10) // "src.backup" = 10 chars, folder always selects all
    })
  })

  describe('Keyboard interactions', () => {
    it('should call node.submit with input value on Enter', () => {
      const node = createMockNode({ name: 'old.txt' })
      renderInput(node)

      const input = screen.getByRole('textbox')
      fireEvent.change(input, { target: { value: 'new.txt' } })
      fireEvent.keyDown(input, { key: 'Enter' })

      expect(node.submit).toHaveBeenCalledWith('new.txt')
    })

    it('should call node.submit with empty string when input is cleared', () => {
      const node = createMockNode({ name: 'old.txt' })
      renderInput(node)

      const input = screen.getByRole('textbox')
      fireEvent.change(input, { target: { value: '' } })
      fireEvent.keyDown(input, { key: 'Enter' })

      expect(node.submit).toHaveBeenCalledWith('')
    })

    it('should call node.reset on Escape', () => {
      const node = createMockNode()
      renderInput(node)

      fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' })

      expect(node.reset).toHaveBeenCalledTimes(1)
      expect(node.submit).not.toHaveBeenCalled()
    })

    it('should stop propagation for all key events', () => {
      const node = createMockNode()
      render(
        <div onKeyDown={() => { throw new Error('should not propagate') }}>
          <TreeEditInput node={node as NodeApi<TreeNodeData>} />
        </div>,
      )

      const input = screen.getByRole('textbox')
      fireEvent.keyDown(input, { key: 'a' })
      fireEvent.keyDown(input, { key: 'Enter' })
      fireEvent.keyDown(input, { key: 'Escape' })
    })
  })

  describe('Blur', () => {
    it('should call node.reset on blur', () => {
      const node = createMockNode()
      renderInput(node)

      fireEvent.blur(screen.getByRole('textbox'))

      expect(node.reset).toHaveBeenCalledTimes(1)
    })
  })

  describe('Click', () => {
    it('should stop click propagation', () => {
      const outerClick = vi.fn()
      const node = createMockNode()
      render(
        <div onClick={outerClick}>
          <TreeEditInput node={node as NodeApi<TreeNodeData>} />
        </div>,
      )

      fireEvent.click(screen.getByRole('textbox'))

      expect(outerClick).not.toHaveBeenCalled()
    })
  })
})
