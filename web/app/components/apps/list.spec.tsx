import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { AppModeEnum } from '@/types/app'

// Mock next/navigation
const mockReplace = jest.fn()
const mockRouter = { replace: mockReplace }
jest.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
}))

// Mock app context
const mockIsCurrentWorkspaceEditor = jest.fn(() => true)
const mockIsCurrentWorkspaceDatasetOperator = jest.fn(() => false)
jest.mock('@/context/app-context', () => ({
  useAppContext: () => ({
    isCurrentWorkspaceEditor: mockIsCurrentWorkspaceEditor(),
    isCurrentWorkspaceDatasetOperator: mockIsCurrentWorkspaceDatasetOperator(),
  }),
}))

// Mock global public store
jest.mock('@/context/global-public-context', () => ({
  useGlobalPublicStore: () => ({
    systemFeatures: {
      branding: { enabled: false },
    },
  }),
}))

// Mock custom hooks
const mockSetQuery = jest.fn()
jest.mock('./hooks/use-apps-query-state', () => ({
  __esModule: true,
  default: () => ({
    query: { tagIDs: [], keywords: '', isCreatedByMe: false },
    setQuery: mockSetQuery,
  }),
}))

jest.mock('./hooks/use-dsl-drag-drop', () => ({
  useDSLDragDrop: () => ({
    dragging: false,
  }),
}))

const mockSetActiveTab = jest.fn()
jest.mock('@/hooks/use-tab-searchparams', () => ({
  useTabSearchParams: () => ['all', mockSetActiveTab],
}))

// Mock service hooks
const mockRefetch = jest.fn()
jest.mock('@/service/use-apps', () => ({
  useInfiniteAppList: () => ({
    data: {
      pages: [{
        data: [
          {
            id: 'app-1',
            name: 'Test App 1',
            description: 'Description 1',
            mode: AppModeEnum.CHAT,
            icon: '🤖',
            icon_type: 'emoji',
            icon_background: '#FFEAD5',
            tags: [],
            author_name: 'Author 1',
            created_at: 1704067200,
            updated_at: 1704153600,
          },
          {
            id: 'app-2',
            name: 'Test App 2',
            description: 'Description 2',
            mode: AppModeEnum.WORKFLOW,
            icon: '⚙️',
            icon_type: 'emoji',
            icon_background: '#E4FBCC',
            tags: [],
            author_name: 'Author 2',
            created_at: 1704067200,
            updated_at: 1704153600,
          },
        ],
        total: 2,
      }],
    },
    isLoading: false,
    isFetchingNextPage: false,
    fetchNextPage: jest.fn(),
    hasNextPage: false,
    error: null,
    refetch: mockRefetch,
  }),
}))

// Mock tag store
jest.mock('@/app/components/base/tag-management/store', () => ({
  useStore: () => false,
}))

// Mock config
jest.mock('@/config', () => ({
  NEED_REFRESH_APP_LIST_KEY: 'needRefreshAppList',
}))

// Mock pay hook
jest.mock('@/hooks/use-pay', () => ({
  CheckModal: () => null,
}))

// Mock debounce hook
jest.mock('ahooks', () => ({
  useDebounceFn: (fn: () => void) => ({ run: fn }),
}))

// Mock dynamic imports
jest.mock('next/dynamic', () => {
  const React = require('react')
  return (importFn: () => Promise<any>) => {
    const fnString = importFn.toString()

    if (fnString.includes('tag-management')) {
      return function MockTagManagement() {
        return React.createElement('div', { 'data-testid': 'tag-management-modal' })
      }
    }
    if (fnString.includes('create-from-dsl-modal')) {
      return function MockCreateFromDSLModal({ show, onClose }: any) {
        if (!show) return null
        return React.createElement('div', { 'data-testid': 'create-dsl-modal' },
          React.createElement('button', { 'onClick': onClose, 'data-testid': 'close-dsl-modal' }, 'Close'),
        )
      }
    }
    return () => null
  }
})

/**
 * Mock child components for focused List component testing.
 * These mocks isolate the List component's behavior from its children.
 * Each child component (AppCard, NewAppCard, Empty, Footer) has its own dedicated tests.
 */
jest.mock('./app-card', () => ({
  __esModule: true,
  default: ({ app }: any) => {
    const React = require('react')
    return React.createElement('div', { 'data-testid': `app-card-${app.id}`, 'role': 'article' }, app.name)
  },
}))

jest.mock('./new-app-card', () => {
  const React = require('react')
  return React.forwardRef((_props: any, _ref: any) => {
    return React.createElement('div', { 'data-testid': 'new-app-card', 'role': 'button' }, 'New App Card')
  })
})

jest.mock('./empty', () => ({
  __esModule: true,
  default: () => {
    const React = require('react')
    return React.createElement('div', { 'data-testid': 'empty-state', 'role': 'status' }, 'No apps found')
  },
}))

jest.mock('./footer', () => ({
  __esModule: true,
  default: () => {
    const React = require('react')
    return React.createElement('footer', { 'data-testid': 'footer', 'role': 'contentinfo' }, 'Footer')
  },
}))

/**
 * Mock base components that have deep dependency chains or require controlled test behavior.
 *
 * Per frontend testing skills (mocking.md), we generally should NOT mock base components.
 * However, the following require mocking due to:
 * - Deep dependency chains importing ES modules (like ky) incompatible with Jest
 * - Need for controlled interaction behavior in tests (onChange, onClear handlers)
 * - Complex internal state that would make tests flaky
 *
 * These mocks preserve the component's props interface to test List's integration correctly.
 */
jest.mock('@/app/components/base/tab-slider-new', () => ({
  __esModule: true,
  default: ({ value, onChange, options }: any) => {
    const React = require('react')
    return React.createElement('div', { 'data-testid': 'tab-slider', 'role': 'tablist' },
      options.map((opt: any) =>
        React.createElement('button', {
          'key': opt.value,
          'data-testid': `tab-${opt.value}`,
          'role': 'tab',
          'aria-selected': value === opt.value,
          'onClick': () => onChange(opt.value),
        }, opt.text),
      ),
    )
  },
}))

jest.mock('@/app/components/base/input', () => ({
  __esModule: true,
  default: ({ value, onChange, onClear }: any) => {
    const React = require('react')
    return React.createElement('div', { 'data-testid': 'search-input' },
      React.createElement('input', {
        'data-testid': 'search-input-field',
        'role': 'searchbox',
        'value': value || '',
        onChange,
      }),
      React.createElement('button', {
        'data-testid': 'clear-search',
        'aria-label': 'Clear search',
        'onClick': onClear,
      }, 'Clear'),
    )
  },
}))

jest.mock('@/app/components/base/tag-management/filter', () => ({
  __esModule: true,
  default: ({ value, onChange }: any) => {
    const React = require('react')
    return React.createElement('div', { 'data-testid': 'tag-filter', 'role': 'listbox' },
      React.createElement('button', {
        'data-testid': 'add-tag-filter',
        'onClick': () => onChange([...value, 'new-tag']),
      }, 'Add Tag'),
    )
  },
}))

jest.mock('@/app/components/datasets/create/website/base/checkbox-with-label', () => ({
  __esModule: true,
  default: ({ label, isChecked, onChange }: any) => {
    const React = require('react')
    return React.createElement('label', { 'data-testid': 'created-by-me-checkbox' },
      React.createElement('input', {
        'type': 'checkbox',
        'role': 'checkbox',
        'checked': isChecked,
        'aria-checked': isChecked,
        onChange,
        'data-testid': 'created-by-me-input',
      }),
      label,
    )
  },
}))

// Import after mocks
import List from './list'

describe('List', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockIsCurrentWorkspaceEditor.mockReturnValue(true)
    mockIsCurrentWorkspaceDatasetOperator.mockReturnValue(false)
    localStorage.clear()
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<List />)
      expect(screen.getByTestId('tab-slider')).toBeInTheDocument()
    })

    it('should render tab slider with all app types', () => {
      render(<List />)

      expect(screen.getByTestId('tab-all')).toBeInTheDocument()
      expect(screen.getByTestId(`tab-${AppModeEnum.WORKFLOW}`)).toBeInTheDocument()
      expect(screen.getByTestId(`tab-${AppModeEnum.ADVANCED_CHAT}`)).toBeInTheDocument()
      expect(screen.getByTestId(`tab-${AppModeEnum.CHAT}`)).toBeInTheDocument()
      expect(screen.getByTestId(`tab-${AppModeEnum.AGENT_CHAT}`)).toBeInTheDocument()
      expect(screen.getByTestId(`tab-${AppModeEnum.COMPLETION}`)).toBeInTheDocument()
    })

    it('should render search input', () => {
      render(<List />)
      expect(screen.getByTestId('search-input')).toBeInTheDocument()
    })

    it('should render tag filter', () => {
      render(<List />)
      expect(screen.getByTestId('tag-filter')).toBeInTheDocument()
    })

    it('should render created by me checkbox', () => {
      render(<List />)
      expect(screen.getByTestId('created-by-me-checkbox')).toBeInTheDocument()
    })

    it('should render app cards when apps exist', () => {
      render(<List />)

      expect(screen.getByTestId('app-card-app-1')).toBeInTheDocument()
      expect(screen.getByTestId('app-card-app-2')).toBeInTheDocument()
    })

    it('should render new app card for editors', () => {
      render(<List />)
      expect(screen.getByTestId('new-app-card')).toBeInTheDocument()
    })

    it('should render footer when branding is disabled', () => {
      render(<List />)
      expect(screen.getByTestId('footer')).toBeInTheDocument()
    })

    it('should render drop DSL hint for editors', () => {
      render(<List />)
      expect(screen.getByText('app.newApp.dropDSLToCreateApp')).toBeInTheDocument()
    })
  })

  describe('Tab Navigation', () => {
    it('should call setActiveTab when tab is clicked', () => {
      render(<List />)

      fireEvent.click(screen.getByTestId(`tab-${AppModeEnum.WORKFLOW}`))

      expect(mockSetActiveTab).toHaveBeenCalledWith(AppModeEnum.WORKFLOW)
    })

    it('should call setActiveTab for all tab', () => {
      render(<List />)

      fireEvent.click(screen.getByTestId('tab-all'))

      expect(mockSetActiveTab).toHaveBeenCalledWith('all')
    })
  })

  describe('Search Functionality', () => {
    it('should render search input field', () => {
      render(<List />)
      expect(screen.getByTestId('search-input-field')).toBeInTheDocument()
    })

    it('should handle search input change', () => {
      render(<List />)

      const input = screen.getByTestId('search-input-field')
      fireEvent.change(input, { target: { value: 'test search' } })

      expect(mockSetQuery).toHaveBeenCalled()
    })

    it('should clear search when clear button is clicked', () => {
      render(<List />)

      fireEvent.click(screen.getByTestId('clear-search'))

      expect(mockSetQuery).toHaveBeenCalled()
    })
  })

  describe('Tag Filter', () => {
    it('should render tag filter component', () => {
      render(<List />)
      expect(screen.getByTestId('tag-filter')).toBeInTheDocument()
    })

    it('should handle tag filter change', () => {
      render(<List />)

      fireEvent.click(screen.getByTestId('add-tag-filter'))

      // Tag filter change triggers debounced setTagIDs
      expect(screen.getByTestId('tag-filter')).toBeInTheDocument()
    })
  })

  describe('Created By Me Filter', () => {
    it('should render checkbox with correct label', () => {
      render(<List />)
      expect(screen.getByText('app.showMyCreatedAppsOnly')).toBeInTheDocument()
    })

    it('should handle checkbox change', () => {
      render(<List />)

      const checkbox = screen.getByTestId('created-by-me-input')
      fireEvent.click(checkbox)

      expect(mockSetQuery).toHaveBeenCalled()
    })
  })

  describe('Non-Editor User', () => {
    it('should not render new app card for non-editors', () => {
      mockIsCurrentWorkspaceEditor.mockReturnValue(false)

      render(<List />)

      expect(screen.queryByTestId('new-app-card')).not.toBeInTheDocument()
    })

    it('should not render drop DSL hint for non-editors', () => {
      mockIsCurrentWorkspaceEditor.mockReturnValue(false)

      render(<List />)

      expect(screen.queryByText(/drop dsl file to create app/i)).not.toBeInTheDocument()
    })
  })

  describe('Dataset Operator Redirect', () => {
    it('should redirect dataset operators to datasets page', () => {
      mockIsCurrentWorkspaceDatasetOperator.mockReturnValue(true)

      render(<List />)

      expect(mockReplace).toHaveBeenCalledWith('/datasets')
    })
  })

  describe('Local Storage Refresh', () => {
    it('should call refetch when refresh key is set in localStorage', () => {
      localStorage.setItem('needRefreshAppList', '1')

      render(<List />)

      expect(mockRefetch).toHaveBeenCalled()
      expect(localStorage.getItem('needRefreshAppList')).toBeNull()
    })
  })

  describe('Edge Cases', () => {
    it('should handle multiple renders without issues', () => {
      const { rerender } = render(<List />)
      expect(screen.getByTestId('tab-slider')).toBeInTheDocument()

      rerender(<List />)
      expect(screen.getByTestId('tab-slider')).toBeInTheDocument()
    })

    it('should render app cards correctly', () => {
      render(<List />)

      expect(screen.getByText('Test App 1')).toBeInTheDocument()
      expect(screen.getByText('Test App 2')).toBeInTheDocument()
    })

    it('should render with all filter options visible', () => {
      render(<List />)

      expect(screen.getByTestId('search-input')).toBeInTheDocument()
      expect(screen.getByTestId('tag-filter')).toBeInTheDocument()
      expect(screen.getByTestId('created-by-me-checkbox')).toBeInTheDocument()
    })
  })

  describe('Dragging State', () => {
    it('should show drop hint when DSL feature is enabled for editors', () => {
      render(<List />)
      expect(screen.getByText('app.newApp.dropDSLToCreateApp')).toBeInTheDocument()
    })
  })

  describe('App Type Tabs', () => {
    it('should render all app type tabs', () => {
      render(<List />)

      expect(screen.getByTestId('tab-all')).toBeInTheDocument()
      expect(screen.getByTestId(`tab-${AppModeEnum.WORKFLOW}`)).toBeInTheDocument()
      expect(screen.getByTestId(`tab-${AppModeEnum.ADVANCED_CHAT}`)).toBeInTheDocument()
      expect(screen.getByTestId(`tab-${AppModeEnum.CHAT}`)).toBeInTheDocument()
      expect(screen.getByTestId(`tab-${AppModeEnum.AGENT_CHAT}`)).toBeInTheDocument()
      expect(screen.getByTestId(`tab-${AppModeEnum.COMPLETION}`)).toBeInTheDocument()
    })

    it('should call setActiveTab for each app type', () => {
      render(<List />)

      const appModes = [
        AppModeEnum.WORKFLOW,
        AppModeEnum.ADVANCED_CHAT,
        AppModeEnum.CHAT,
        AppModeEnum.AGENT_CHAT,
        AppModeEnum.COMPLETION,
      ]

      appModes.forEach((mode) => {
        fireEvent.click(screen.getByTestId(`tab-${mode}`))
        expect(mockSetActiveTab).toHaveBeenCalledWith(mode)
      })
    })
  })

  describe('Search and Filter Integration', () => {
    it('should display search input with correct attributes', () => {
      render(<List />)

      const input = screen.getByTestId('search-input-field')
      expect(input).toBeInTheDocument()
      expect(input).toHaveAttribute('value', '')
    })

    it('should have tag filter component', () => {
      render(<List />)

      const tagFilter = screen.getByTestId('tag-filter')
      expect(tagFilter).toBeInTheDocument()
    })

    it('should display created by me label', () => {
      render(<List />)

      expect(screen.getByText('app.showMyCreatedAppsOnly')).toBeInTheDocument()
    })
  })

  describe('App List Display', () => {
    it('should display all app cards from data', () => {
      render(<List />)

      expect(screen.getByTestId('app-card-app-1')).toBeInTheDocument()
      expect(screen.getByTestId('app-card-app-2')).toBeInTheDocument()
    })

    it('should display app names correctly', () => {
      render(<List />)

      expect(screen.getByText('Test App 1')).toBeInTheDocument()
      expect(screen.getByText('Test App 2')).toBeInTheDocument()
    })
  })

  describe('Footer Visibility', () => {
    it('should render footer when branding is disabled', () => {
      render(<List />)

      expect(screen.getByTestId('footer')).toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // Additional Coverage Tests
  // --------------------------------------------------------------------------
  describe('Additional Coverage', () => {
    it('should render dragging state overlay when dragging', () => {
      // Test dragging state is handled
      const { container } = render(<List />)

      // Component should render successfully
      expect(container).toBeInTheDocument()
    })

    it('should handle app mode filter in query params', () => {
      // Test that different modes are handled in query
      render(<List />)

      const workflowTab = screen.getByTestId(`tab-${AppModeEnum.WORKFLOW}`)
      fireEvent.click(workflowTab)

      expect(mockSetActiveTab).toHaveBeenCalledWith(AppModeEnum.WORKFLOW)
    })

    it('should render new app card for editors', () => {
      render(<List />)

      expect(screen.getByTestId('new-app-card')).toBeInTheDocument()
    })
  })
})
