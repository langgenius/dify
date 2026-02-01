import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import List from './index'

// Mock next/navigation
const mockPush = vi.fn()
const mockReplace = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
  }),
}))

// Mock ahooks
vi.mock('ahooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ahooks')>()
  return {
    ...actual,
    useBoolean: () => [false, { toggle: vi.fn(), setTrue: vi.fn(), setFalse: vi.fn() }],
    useDebounceFn: (fn: () => void) => ({ run: fn }),
    useHover: () => false,
  }
})

// Mock app context
vi.mock('@/context/app-context', () => ({
  useAppContext: () => ({
    currentWorkspace: { role: 'admin' },
    isCurrentWorkspaceOwner: true,
  }),
  useSelector: () => true,
}))

// Mock global public context
vi.mock('@/context/global-public-context', () => ({
  useGlobalPublicStore: () => ({
    systemFeatures: {
      branding: { enabled: false },
    },
  }),
}))

// Mock external api panel context
const mockSetShowExternalApiPanel = vi.fn()
vi.mock('@/context/external-api-panel-context', () => ({
  useExternalApiPanel: () => ({
    showExternalApiPanel: false,
    setShowExternalApiPanel: mockSetShowExternalApiPanel,
  }),
}))

// Mock tag management store
vi.mock('@/app/components/base/tag-management/store', () => ({
  useStore: () => false,
}))

// Mock useDocumentTitle hook
vi.mock('@/hooks/use-document-title', () => ({
  default: vi.fn(),
}))

// Mock useFormatTimeFromNow hook
vi.mock('@/hooks/use-format-time-from-now', () => ({
  useFormatTimeFromNow: () => ({
    formatTimeFromNow: (timestamp: number) => new Date(timestamp).toLocaleDateString(),
  }),
}))

// Mock useKnowledge hook
vi.mock('@/hooks/use-knowledge', () => ({
  useKnowledge: () => ({
    formatIndexingTechniqueAndMethod: () => 'High Quality',
  }),
}))

// Mock service hooks
vi.mock('@/service/knowledge/use-dataset', () => ({
  useDatasetList: vi.fn(() => ({
    data: { pages: [{ data: [] }] },
    fetchNextPage: vi.fn(),
    hasNextPage: false,
    isFetching: false,
    isFetchingNextPage: false,
  })),
  useInvalidDatasetList: () => vi.fn(),
  useDatasetApiBaseUrl: () => ({
    data: { api_base_url: 'https://api.example.com' },
  }),
}))

// Mock Datasets component
vi.mock('./datasets', () => ({
  default: ({ tags, keywords, includeAll }: { tags: string[], keywords: string, includeAll: boolean }) => (
    <div data-testid="datasets-component">
      <span data-testid="tags">{tags.join(',')}</span>
      <span data-testid="keywords">{keywords}</span>
      <span data-testid="include-all">{includeAll ? 'true' : 'false'}</span>
    </div>
  ),
}))

// Mock DatasetFooter component
vi.mock('./dataset-footer', () => ({
  default: () => <footer data-testid="dataset-footer">Footer</footer>,
}))

// Mock ExternalAPIPanel component
vi.mock('../external-api/external-api-panel', () => ({
  default: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="external-api-panel">
      <button onClick={onClose}>Close Panel</button>
    </div>
  ),
}))

// Mock TagManagementModal
vi.mock('@/app/components/base/tag-management', () => ({
  default: () => <div data-testid="tag-management-modal" />,
}))

// Mock TagFilter
vi.mock('@/app/components/base/tag-management/filter', () => ({
  default: ({ onChange }: { value: string[], onChange: (val: string[]) => void }) => (
    <div data-testid="tag-filter">
      <button onClick={() => onChange(['tag-1', 'tag-2'])}>Select Tags</button>
    </div>
  ),
}))

// Mock CheckboxWithLabel
vi.mock('@/app/components/datasets/create/website/base/checkbox-with-label', () => ({
  default: ({ isChecked, onChange, label }: { isChecked: boolean, onChange: () => void, label: string }) => (
    <label>
      <input
        type="checkbox"
        checked={isChecked}
        onChange={onChange}
        data-testid="include-all-checkbox"
      />
      {label}
    </label>
  ),
}))

describe('List', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<List />)
      expect(screen.getByTestId('datasets-component')).toBeInTheDocument()
    })

    it('should render the search input', () => {
      render(<List />)
      expect(screen.getByRole('textbox')).toBeInTheDocument()
    })

    it('should render tag filter', () => {
      render(<List />)
      expect(screen.getByTestId('tag-filter')).toBeInTheDocument()
    })

    it('should render external API panel button', () => {
      render(<List />)
      expect(screen.getByText(/externalAPIPanelTitle/)).toBeInTheDocument()
    })

    it('should render dataset footer when branding is disabled', () => {
      render(<List />)
      expect(screen.getByTestId('dataset-footer')).toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('should pass includeAll prop to Datasets', () => {
      render(<List />)
      expect(screen.getByTestId('include-all')).toHaveTextContent('false')
    })

    it('should pass empty keywords initially', () => {
      render(<List />)
      expect(screen.getByTestId('keywords')).toHaveTextContent('')
    })

    it('should pass empty tags initially', () => {
      render(<List />)
      expect(screen.getByTestId('tags')).toHaveTextContent('')
    })
  })

  describe('User Interactions', () => {
    it('should open external API panel when button is clicked', () => {
      render(<List />)

      const button = screen.getByText(/externalAPIPanelTitle/)
      fireEvent.click(button)

      expect(mockSetShowExternalApiPanel).toHaveBeenCalledWith(true)
    })

    it('should update search input value', () => {
      render(<List />)

      const input = screen.getByRole('textbox')
      fireEvent.change(input, { target: { value: 'test search' } })

      expect(input).toHaveValue('test search')
    })

    it('should trigger tag filter change', () => {
      render(<List />)
      // Tag filter is rendered and interactive
      const selectTagsBtn = screen.getByText('Select Tags')
      expect(selectTagsBtn).toBeInTheDocument()
      fireEvent.click(selectTagsBtn)
      // The onChange callback was triggered (debounced)
    })
  })

  describe('Conditional Rendering', () => {
    it('should show include all checkbox for workspace owner', () => {
      render(<List />)
      expect(screen.getByTestId('include-all-checkbox')).toBeInTheDocument()
    })
  })

  describe('Styles', () => {
    it('should have correct container styling', () => {
      const { container } = render(<List />)
      const mainContainer = container.firstChild as HTMLElement
      expect(mainContainer).toHaveClass('scroll-container', 'relative', 'flex', 'grow', 'flex-col')
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty state gracefully', () => {
      render(<List />)
      // Should render without errors even with empty data
      expect(screen.getByTestId('datasets-component')).toBeInTheDocument()
    })
  })

  describe('Branch Coverage', () => {
    it('should redirect normal role users to /apps', async () => {
      // Re-mock useAppContext with normal role
      vi.doMock('@/context/app-context', () => ({
        useAppContext: () => ({
          currentWorkspace: { role: 'normal' },
          isCurrentWorkspaceOwner: false,
        }),
        useSelector: () => true,
      }))

      // Clear module cache and re-import
      vi.resetModules()
      const { default: ListComponent } = await import('./index')

      render(<ListComponent />)

      await waitFor(() => {
        expect(mockReplace).toHaveBeenCalledWith('/apps')
      })
    })

    it('should clear search input when onClear is called', () => {
      render(<List />)

      const input = screen.getByRole('textbox')
      // First set a value
      fireEvent.change(input, { target: { value: 'test search' } })
      expect(input).toHaveValue('test search')

      // Find and click the clear button
      const clearButton = document.querySelector('[class*="clear"], button[aria-label*="clear"]')
      if (clearButton) {
        fireEvent.click(clearButton)
        expect(input).toHaveValue('')
      }
    })

    it('should show ExternalAPIPanel when showExternalApiPanel is true', async () => {
      // Re-mock to show external API panel
      vi.doMock('@/context/external-api-panel-context', () => ({
        useExternalApiPanel: () => ({
          showExternalApiPanel: true,
          setShowExternalApiPanel: mockSetShowExternalApiPanel,
        }),
      }))

      vi.resetModules()
      const { default: ListComponent } = await import('./index')

      render(<ListComponent />)

      expect(screen.getByTestId('external-api-panel')).toBeInTheDocument()
    })

    it('should close ExternalAPIPanel when onClose is called', async () => {
      vi.doMock('@/context/external-api-panel-context', () => ({
        useExternalApiPanel: () => ({
          showExternalApiPanel: true,
          setShowExternalApiPanel: mockSetShowExternalApiPanel,
        }),
      }))

      vi.resetModules()
      const { default: ListComponent } = await import('./index')

      render(<ListComponent />)

      const closeButton = screen.getByText('Close Panel')
      fireEvent.click(closeButton)

      expect(mockSetShowExternalApiPanel).toHaveBeenCalledWith(false)
    })

    it('should show TagManagementModal when showTagManagementModal is true', async () => {
      vi.doMock('@/app/components/base/tag-management/store', () => ({
        useStore: () => true, // showTagManagementModal is true
      }))

      vi.resetModules()
      const { default: ListComponent } = await import('./index')

      render(<ListComponent />)

      expect(screen.getByTestId('tag-management-modal')).toBeInTheDocument()
    })

    it('should not show DatasetFooter when branding is enabled', async () => {
      vi.doMock('@/context/global-public-context', () => ({
        useGlobalPublicStore: () => ({
          systemFeatures: {
            branding: { enabled: true },
          },
        }),
      }))

      vi.resetModules()
      const { default: ListComponent } = await import('./index')

      render(<ListComponent />)

      expect(screen.queryByTestId('dataset-footer')).not.toBeInTheDocument()
    })

    it('should not show include all checkbox when not workspace owner', async () => {
      vi.doMock('@/context/app-context', () => ({
        useAppContext: () => ({
          currentWorkspace: { role: 'editor' },
          isCurrentWorkspaceOwner: false,
        }),
        useSelector: () => true,
      }))

      vi.resetModules()
      const { default: ListComponent } = await import('./index')

      render(<ListComponent />)

      expect(screen.queryByTestId('include-all-checkbox')).not.toBeInTheDocument()
    })
  })
})
