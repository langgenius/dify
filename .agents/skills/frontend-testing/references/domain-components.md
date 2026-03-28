# Domain-Specific Component Testing

This guide covers testing patterns for Dify's domain-specific components.

## Workflow Components (`workflow/`)

Workflow components handle node configuration, data flow, and graph operations.

### Key Test Areas

1. **Node Configuration**
1. **Data Validation**
1. **Variable Passing**
1. **Edge Connections**
1. **Error Handling**

### Example: Node Configuration Panel

```typescript
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import NodeConfigPanel from './node-config-panel'
import { createMockNode, createMockWorkflowContext } from '@/__mocks__/workflow'

// Mock workflow context
vi.mock('@/app/components/workflow/hooks', () => ({
  useWorkflowStore: () => mockWorkflowStore,
  useNodesInteractions: () => mockNodesInteractions,
}))

let mockWorkflowStore = {
  nodes: [],
  edges: [],
  updateNode: vi.fn(),
}

let mockNodesInteractions = {
  handleNodeSelect: vi.fn(),
  handleNodeDelete: vi.fn(),
}

describe('NodeConfigPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWorkflowStore = {
      nodes: [],
      edges: [],
      updateNode: vi.fn(),
    }
  })

  describe('Node Configuration', () => {
    it('should render node type selector', () => {
      const node = createMockNode({ type: 'llm' })
      render(<NodeConfigPanel node={node} />)
      
      expect(screen.getByLabelText(/model/i)).toBeInTheDocument()
    })

    it('should update node config on change', async () => {
      const user = userEvent.setup()
      const node = createMockNode({ type: 'llm' })
      
      render(<NodeConfigPanel node={node} />)
      
      await user.selectOptions(screen.getByLabelText(/model/i), 'gpt-4')
      
      expect(mockWorkflowStore.updateNode).toHaveBeenCalledWith(
        node.id,
        expect.objectContaining({ model: 'gpt-4' })
      )
    })
  })

  describe('Data Validation', () => {
    it('should show error for invalid input', async () => {
      const user = userEvent.setup()
      const node = createMockNode({ type: 'code' })
      
      render(<NodeConfigPanel node={node} />)
      
      // Enter invalid code
      const codeInput = screen.getByLabelText(/code/i)
      await user.clear(codeInput)
      await user.type(codeInput, 'invalid syntax {{{')
      
      await waitFor(() => {
        expect(screen.getByText(/syntax error/i)).toBeInTheDocument()
      })
    })

    it('should validate required fields', async () => {
      const node = createMockNode({ type: 'http', data: { url: '' } })
      
      render(<NodeConfigPanel node={node} />)
      
      fireEvent.click(screen.getByRole('button', { name: /save/i }))
      
      await waitFor(() => {
        expect(screen.getByText(/url is required/i)).toBeInTheDocument()
      })
    })
  })

  describe('Variable Passing', () => {
    it('should display available variables from upstream nodes', () => {
      const upstreamNode = createMockNode({
        id: 'node-1',
        type: 'start',
        data: { outputs: [{ name: 'user_input', type: 'string' }] },
      })
      const currentNode = createMockNode({
        id: 'node-2',
        type: 'llm',
      })
      
      mockWorkflowStore.nodes = [upstreamNode, currentNode]
      mockWorkflowStore.edges = [{ source: 'node-1', target: 'node-2' }]
      
      render(<NodeConfigPanel node={currentNode} />)
      
      // Variable selector should show upstream variables
      fireEvent.click(screen.getByRole('button', { name: /add variable/i }))
      
      expect(screen.getByText('user_input')).toBeInTheDocument()
    })

    it('should insert variable into prompt template', async () => {
      const user = userEvent.setup()
      const node = createMockNode({ type: 'llm' })
      
      render(<NodeConfigPanel node={node} />)
      
      // Click variable button
      await user.click(screen.getByRole('button', { name: /insert variable/i }))
      await user.click(screen.getByText('user_input'))
      
      const promptInput = screen.getByLabelText(/prompt/i)
      expect(promptInput).toHaveValue(expect.stringContaining('{{user_input}}'))
    })
  })
})
```

## Dataset Components (`dataset/`)

Dataset components handle file uploads, data display, and search/filter operations.

### Key Test Areas

1. **File Upload**
1. **File Type Validation**
1. **Pagination**
1. **Search & Filtering**
1. **Data Format Handling**

### Example: Document Uploader

```typescript
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DocumentUploader from './document-uploader'

vi.mock('@/service/datasets', () => ({
  uploadDocument: vi.fn(),
  parseDocument: vi.fn(),
}))

import * as datasetService from '@/service/datasets'
const mockedService = vi.mocked(datasetService)

describe('DocumentUploader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('File Upload', () => {
    it('should accept valid file types', async () => {
      const user = userEvent.setup()
      const onUpload = vi.fn()
      mockedService.uploadDocument.mockResolvedValue({ id: 'doc-1' })
      
      render(<DocumentUploader onUpload={onUpload} />)
      
      const file = new File(['content'], 'test.pdf', { type: 'application/pdf' })
      const input = screen.getByLabelText(/upload/i)
      
      await user.upload(input, file)
      
      await waitFor(() => {
        expect(mockedService.uploadDocument).toHaveBeenCalledWith(
          expect.any(FormData)
        )
      })
    })

    it('should reject invalid file types', async () => {
      const user = userEvent.setup()
      
      render(<DocumentUploader />)
      
      const file = new File(['content'], 'test.exe', { type: 'application/x-msdownload' })
      const input = screen.getByLabelText(/upload/i)
      
      await user.upload(input, file)
      
      expect(screen.getByText(/unsupported file type/i)).toBeInTheDocument()
      expect(mockedService.uploadDocument).not.toHaveBeenCalled()
    })

    it('should show upload progress', async () => {
      const user = userEvent.setup()
      
      // Mock upload with progress
      mockedService.uploadDocument.mockImplementation(() => {
        return new Promise((resolve) => {
          setTimeout(() => resolve({ id: 'doc-1' }), 100)
        })
      })
      
      render(<DocumentUploader />)
      
      const file = new File(['content'], 'test.pdf', { type: 'application/pdf' })
      await user.upload(screen.getByLabelText(/upload/i), file)
      
      expect(screen.getByRole('progressbar')).toBeInTheDocument()
      
      await waitFor(() => {
        expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
      })
    })
  })

  describe('Error Handling', () => {
    it('should handle upload failure', async () => {
      const user = userEvent.setup()
      mockedService.uploadDocument.mockRejectedValue(new Error('Upload failed'))
      
      render(<DocumentUploader />)
      
      const file = new File(['content'], 'test.pdf', { type: 'application/pdf' })
      await user.upload(screen.getByLabelText(/upload/i), file)
      
      await waitFor(() => {
        expect(screen.getByText(/upload failed/i)).toBeInTheDocument()
      })
    })

    it('should allow retry after failure', async () => {
      const user = userEvent.setup()
      mockedService.uploadDocument
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({ id: 'doc-1' })
      
      render(<DocumentUploader />)
      
      const file = new File(['content'], 'test.pdf', { type: 'application/pdf' })
      await user.upload(screen.getByLabelText(/upload/i), file)
      
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
      })
      
      await user.click(screen.getByRole('button', { name: /retry/i }))
      
      await waitFor(() => {
        expect(screen.getByText(/uploaded successfully/i)).toBeInTheDocument()
      })
    })
  })
})
```

### Example: Document List with Pagination

```typescript
describe('DocumentList', () => {
  describe('Pagination', () => {
    it('should load first page on mount', async () => {
      mockedService.getDocuments.mockResolvedValue({
        data: [{ id: '1', name: 'Doc 1' }],
        total: 50,
        page: 1,
        pageSize: 10,
      })
      
      render(<DocumentList datasetId="ds-1" />)
      
      await waitFor(() => {
        expect(screen.getByText('Doc 1')).toBeInTheDocument()
      })
      
      expect(mockedService.getDocuments).toHaveBeenCalledWith('ds-1', { page: 1 })
    })

    it('should navigate to next page', async () => {
      const user = userEvent.setup()
      mockedService.getDocuments.mockResolvedValue({
        data: [{ id: '1', name: 'Doc 1' }],
        total: 50,
        page: 1,
        pageSize: 10,
      })
      
      render(<DocumentList datasetId="ds-1" />)
      
      await waitFor(() => {
        expect(screen.getByText('Doc 1')).toBeInTheDocument()
      })
      
      mockedService.getDocuments.mockResolvedValue({
        data: [{ id: '11', name: 'Doc 11' }],
        total: 50,
        page: 2,
        pageSize: 10,
      })
      
      await user.click(screen.getByRole('button', { name: /next/i }))
      
      await waitFor(() => {
        expect(screen.getByText('Doc 11')).toBeInTheDocument()
      })
    })
  })

  describe('Search & Filtering', () => {
    it('should filter by search query', async () => {
      const user = userEvent.setup()
      vi.useFakeTimers()
      
      render(<DocumentList datasetId="ds-1" />)
      
      await user.type(screen.getByPlaceholderText(/search/i), 'test query')
      
      // Debounce
      vi.advanceTimersByTime(300)
      
      await waitFor(() => {
        expect(mockedService.getDocuments).toHaveBeenCalledWith(
          'ds-1',
          expect.objectContaining({ search: 'test query' })
        )
      })
      
      vi.useRealTimers()
    })
  })
})
```

## Configuration Components (`app/configuration/`, `config/`)

Configuration components handle forms, validation, and data persistence.

### Key Test Areas

1. **Form Validation**
1. **Save/Reset**
1. **Required vs Optional Fields**
1. **Configuration Persistence**
1. **Error Feedback**

### Example: App Configuration Form

```typescript
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AppConfigForm from './app-config-form'

vi.mock('@/service/apps', () => ({
  updateAppConfig: vi.fn(),
  getAppConfig: vi.fn(),
}))

import * as appService from '@/service/apps'
const mockedService = vi.mocked(appService)

describe('AppConfigForm', () => {
  const defaultConfig = {
    name: 'My App',
    description: '',
    icon: 'default',
    openingStatement: '',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockedService.getAppConfig.mockResolvedValue(defaultConfig)
  })

  describe('Form Validation', () => {
    it('should require app name', async () => {
      const user = userEvent.setup()
      
      render(<AppConfigForm appId="app-1" />)
      
      await waitFor(() => {
        expect(screen.getByLabelText(/name/i)).toHaveValue('My App')
      })
      
      // Clear name field
      await user.clear(screen.getByLabelText(/name/i))
      await user.click(screen.getByRole('button', { name: /save/i }))
      
      expect(screen.getByText(/name is required/i)).toBeInTheDocument()
      expect(mockedService.updateAppConfig).not.toHaveBeenCalled()
    })

    it('should validate name length', async () => {
      const user = userEvent.setup()
      
      render(<AppConfigForm appId="app-1" />)
      
      await waitFor(() => {
        expect(screen.getByLabelText(/name/i)).toBeInTheDocument()
      })
      
      // Enter very long name
      await user.clear(screen.getByLabelText(/name/i))
      await user.type(screen.getByLabelText(/name/i), 'a'.repeat(101))
      
      expect(screen.getByText(/name must be less than 100 characters/i)).toBeInTheDocument()
    })

    it('should allow empty optional fields', async () => {
      const user = userEvent.setup()
      mockedService.updateAppConfig.mockResolvedValue({ success: true })
      
      render(<AppConfigForm appId="app-1" />)
      
      await waitFor(() => {
        expect(screen.getByLabelText(/name/i)).toHaveValue('My App')
      })
      
      // Leave description empty (optional)
      await user.click(screen.getByRole('button', { name: /save/i }))
      
      await waitFor(() => {
        expect(mockedService.updateAppConfig).toHaveBeenCalled()
      })
    })
  })

  describe('Save/Reset Functionality', () => {
    it('should save configuration', async () => {
      const user = userEvent.setup()
      mockedService.updateAppConfig.mockResolvedValue({ success: true })
      
      render(<AppConfigForm appId="app-1" />)
      
      await waitFor(() => {
        expect(screen.getByLabelText(/name/i)).toHaveValue('My App')
      })
      
      await user.clear(screen.getByLabelText(/name/i))
      await user.type(screen.getByLabelText(/name/i), 'Updated App')
      await user.click(screen.getByRole('button', { name: /save/i }))
      
      await waitFor(() => {
        expect(mockedService.updateAppConfig).toHaveBeenCalledWith(
          'app-1',
          expect.objectContaining({ name: 'Updated App' })
        )
      })
      
      expect(screen.getByText(/saved successfully/i)).toBeInTheDocument()
    })

    it('should reset to default values', async () => {
      const user = userEvent.setup()
      
      render(<AppConfigForm appId="app-1" />)
      
      await waitFor(() => {
        expect(screen.getByLabelText(/name/i)).toHaveValue('My App')
      })
      
      // Make changes
      await user.clear(screen.getByLabelText(/name/i))
      await user.type(screen.getByLabelText(/name/i), 'Changed Name')
      
      // Reset
      await user.click(screen.getByRole('button', { name: /reset/i }))
      
      expect(screen.getByLabelText(/name/i)).toHaveValue('My App')
    })

    it('should show unsaved changes warning', async () => {
      const user = userEvent.setup()
      
      render(<AppConfigForm appId="app-1" />)
      
      await waitFor(() => {
        expect(screen.getByLabelText(/name/i)).toHaveValue('My App')
      })
      
      // Make changes
      await user.type(screen.getByLabelText(/name/i), ' Updated')
      
      expect(screen.getByText(/unsaved changes/i)).toBeInTheDocument()
    })
  })

  describe('Error Handling', () => {
    it('should show error on save failure', async () => {
      const user = userEvent.setup()
      mockedService.updateAppConfig.mockRejectedValue(new Error('Server error'))
      
      render(<AppConfigForm appId="app-1" />)
      
      await waitFor(() => {
        expect(screen.getByLabelText(/name/i)).toHaveValue('My App')
      })
      
      await user.click(screen.getByRole('button', { name: /save/i }))
      
      await waitFor(() => {
        expect(screen.getByText(/failed to save/i)).toBeInTheDocument()
      })
    })
  })
})
```
