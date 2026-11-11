import { fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
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

vi.mock('../../../hooks', () => ({
  useOnlineDriveFiles: () => ({
    isLoading: false,
    fileList: [
      { id: 'file-1', name: 'alpha.pdf', type: 'file', size: 1024 },
      { id: 'file-2', name: 'beta.pdf', type: 'file', size: 2048 },
    ],
    keywords: '',
    setNextPageParameters: vi.fn(),
    currentNextPageParametersRef: { current: {} },
    isTruncated: false,
  }),
  useOnlineDriveBreadcrumbs: () => ({
    breadcrumbs: [],
    setBreadcrumbs: vi.fn(),
    setPrefix: vi.fn(),
    setBucket: vi.fn(),
    hasBucket: false,
  }),
}))

// Capture the RadioGroup's controlled value across renders
const radioValues: (string | undefined)[] = []

vi.mock('@langgenius/dify-ui/radio-group', () => ({
  RadioGroup: ({
    value,
    onValueChange,
  }: {
    value?: string
    onValueChange?: (v: string) => void
  }) => {
    radioValues.push(value)
    return (
      <div role="radiogroup" data-testid="radio-group" data-value={value}>
        <button
          role="radio"
          aria-checked={value === 'file-2'}
          data-testid="radio-file-2"
          onClick={() => onValueChange?.('file-2')}
        >
          radio file-2
        </button>
      </div>
    )
  },
  Radio: () => <span />,
}))

const renderFileList = (selectedFileIds: string[], handleSelectFile = vi.fn()) => {
  render(
    <FileList
      fileList={[
        { id: 'file-1', name: 'alpha.pdf', type: 'file', size: 1024 },
        { id: 'file-2', name: 'beta.pdf', type: 'file', size: 2048 },
      ]}
      selectedFileIds={selectedFileIds}
      breadcrumbs={[]}
      keywords=""
      bucket=""
      isInPipeline={false}
      resetKeywords={vi.fn()}
      updateKeywords={vi.fn()}
      searchResultsLength={0}
      handleSelectFile={handleSelectFile}
      handleOpenFolder={vi.fn()}
      isLoading={false}
      supportBatchUpload={false}
    />,
  )
  return handleSelectFile
}

describe('online drive file list radio group', () => {
  it('keeps RadioGroup controlled when no file is selected initially', () => {
    const handleSelectFile = renderFileList([])

    // First recorded value must be '' (controlled), never undefined (uncontrolled)
    expect(radioValues[0]).toBe('')

    // Simulate the radio change - the parent records the selection
    fireEvent.click(screen.getByTestId('radio-file-2'))
    expect(handleSelectFile).toHaveBeenCalledWith(expect.objectContaining({ id: 'file-2' }))

    // Re-render with the selection applied: value stays controlled and reflects it
    radioValues.length = 0
    renderFileList(['file-2'])
    expect(radioValues[radioValues.length - 1]).toBe('file-2')
  })
})
