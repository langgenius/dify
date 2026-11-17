import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import FileList from '../index'

// Mock store - context provider requires mocking
const mockStoreState = {
  setNextPageParameters: vi.fn(),
  currentNextPageParametersRef: { current: {} },
  isTruncated: { current: false },
  hasBucket: false,
  setOnlineDriveFileList: vi.fn(),
  setSelectedFileIds: vi.fn(),
  setBreadcrumbs: vi.fn(),
  setPrefix: vi.fn(),
  setBucket: vi.fn(),
}

const mockGetState = vi.fn(() => mockStoreState)
const mockDataSourceStore = { getState: mockGetState }

vi.mock('../../../store', () => ({
  useDataSourceStore: () => mockDataSourceStore,
  useDataSourceStoreWithSelector: (selector: (s: typeof mockStoreState) => unknown) =>
    selector(mockStoreState),
}))

type FileListProps = React.ComponentProps<typeof FileList>

const createDefaultProps = (overrides?: Partial<FileListProps>): FileListProps => ({
  fileList: [],
  selectedFileIds: [],
  breadcrumbs: [],
  keywords: '',
  bucket: '',
  isInPipeline: false,
  resetKeywords: vi.fn(),
  updateKeywords: vi.fn(),
  searchResultsLength: 0,
  handleSelectFile: vi.fn(),
  handleOpenFolder: vi.fn(),
  isLoading: false,
  supportBatchUpload: true,
  ...overrides,
})

const resetMockStoreState = () => {
  mockStoreState.setNextPageParameters = vi.fn()
  mockStoreState.currentNextPageParametersRef = { current: {} }
  mockStoreState.isTruncated = { current: false }
  mockStoreState.hasBucket = false
  mockStoreState.setOnlineDriveFileList = vi.fn()
  mockStoreState.setSelectedFileIds = vi.fn()
  mockStoreState.setBreadcrumbs = vi.fn()
  mockStoreState.setPrefix = vi.fn()
  mockStoreState.setBucket = vi.fn()
}

describe('FileList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetMockStoreState()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  describe('State Management', () => {
    describe('debounced keywords update', () => {
      it('should delay the search until typing has stopped', () => {
        vi.useFakeTimers({ shouldAdvanceTime: true })
        const mockUpdateKeywords = vi.fn()
        const props = createDefaultProps({ updateKeywords: mockUpdateKeywords })
        render(<FileList {...props} />)
        const input = screen.getByPlaceholderText(
          'datasetPipeline.onlineDrive.breadcrumbs.searchPlaceholder',
        )

        fireEvent.change(input, { target: { value: 'debounced-value' } })

        expect(mockUpdateKeywords).not.toHaveBeenCalled()
        act(() => vi.advanceTimersByTime(499))
        expect(mockUpdateKeywords).not.toHaveBeenCalled()
        act(() => vi.advanceTimersByTime(1))
        expect(mockUpdateKeywords).toHaveBeenCalledExactlyOnceWith('debounced-value')
      })
    })
  })

  // Event Handlers Tests
  describe('Event Handlers', () => {
    describe('handleInputChange', () => {
      it('should search only for the latest input after rapid changes', () => {
        vi.useFakeTimers({ shouldAdvanceTime: true })
        const mockUpdateKeywords = vi.fn()
        const props = createDefaultProps({ updateKeywords: mockUpdateKeywords })
        render(<FileList {...props} />)
        const input = screen.getByPlaceholderText(
          'datasetPipeline.onlineDrive.breadcrumbs.searchPlaceholder',
        )

        fireEvent.change(input, { target: { value: 'a' } })
        fireEvent.change(input, { target: { value: 'ab' } })
        fireEvent.change(input, { target: { value: 'abc' } })

        act(() => vi.advanceTimersByTime(500))
        expect(mockUpdateKeywords).toHaveBeenCalledExactlyOnceWith('abc')
        expect(input).toHaveValue('abc')
      })
    })

    describe('handleResetKeywords', () => {
      it('should cancel the pending search before clearing the query', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true })
        const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
        const mockResetKeywords = vi.fn()
        const props = createDefaultProps({ resetKeywords: mockResetKeywords })
        render(<FileList {...props} />)
        const input = screen.getByRole('searchbox', {
          name: 'datasetPipeline.onlineDrive.breadcrumbs.searchPlaceholder',
        })

        await user.type(input, 'report')
        await user.click(screen.getByRole('button', { name: 'common.operation.clear' }))

        act(() => vi.advanceTimersByTime(500))
        expect(props.updateKeywords).not.toHaveBeenCalled()
        expect(mockResetKeywords).toHaveBeenCalledOnce()
        expect(input).toHaveValue('')
      })
    })
  })

  // File Type Variations

  // Search Results Display

  // Callback Stability
})

it('clears an unmatched drive search from the empty-result action', async () => {
  const user = userEvent.setup()
  const props = createDefaultProps({ keywords: 'missing' })
  render(<FileList {...props} />)
  await user.click(
    screen.getByRole('button', { name: 'datasetPipeline.onlineDrive.resetKeywords' }),
  )
  expect(props.resetKeywords).toHaveBeenCalledOnce()
})
