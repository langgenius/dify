import type { FileEntity } from './types'
import { render, renderHook, screen } from '@testing-library/react'
import { TransferMethod } from '@/types/app'
import { createFileStore, FileContext, FileContextProvider, useFileStore, useStore } from './store'

const createMockFile = (overrides: Partial<FileEntity> = {}): FileEntity => ({
  id: 'file-1',
  name: 'test.txt',
  size: 1024,
  type: 'text/plain',
  progress: 100,
  transferMethod: TransferMethod.local_file,
  supportFileType: 'document',
  ...overrides,
})

describe('createFileStore', () => {
  it('should create a store with empty files by default', () => {
    const store = createFileStore()
    expect(store.getState().files).toEqual([])
  })

  it('should create a store with empty array when value is falsy', () => {
    const store = createFileStore(undefined)
    expect(store.getState().files).toEqual([])
  })

  it('should create a store with initial files', () => {
    const files = [createMockFile()]
    const store = createFileStore(files)
    expect(store.getState().files).toEqual(files)
  })

  it('should spread initial value to create a new array', () => {
    const files = [createMockFile()]
    const store = createFileStore(files)
    expect(store.getState().files).not.toBe(files)
    expect(store.getState().files).toEqual(files)
  })

  it('should update files via setFiles', () => {
    const store = createFileStore()
    const newFiles = [createMockFile()]
    store.getState().setFiles(newFiles)
    expect(store.getState().files).toEqual(newFiles)
  })

  it('should call onChange when setFiles is called', () => {
    const onChange = vi.fn()
    const store = createFileStore([], onChange)
    const newFiles = [createMockFile()]
    store.getState().setFiles(newFiles)
    expect(onChange).toHaveBeenCalledWith(newFiles)
  })

  it('should not throw when onChange is not provided', () => {
    const store = createFileStore()
    expect(() => store.getState().setFiles([])).not.toThrow()
  })
})

describe('useStore', () => {
  it('should return selected state from the store', () => {
    const files = [createMockFile()]
    const store = createFileStore(files)

    const { result } = renderHook(() => useStore(s => s.files), {
      wrapper: ({ children }) => (
        <FileContext.Provider value={store}>{children}</FileContext.Provider>
      ),
    })

    expect(result.current).toEqual(files)
  })

  it('should throw when used without FileContext.Provider', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => {
      renderHook(() => useStore(s => s.files))
    }).toThrow('Missing FileContext.Provider in the tree')

    consoleError.mockRestore()
  })
})

describe('useFileStore', () => {
  it('should return the store from context', () => {
    const store = createFileStore()

    const { result } = renderHook(() => useFileStore(), {
      wrapper: ({ children }) => (
        <FileContext.Provider value={store}>{children}</FileContext.Provider>
      ),
    })

    expect(result.current).toBe(store)
  })
})

describe('FileContextProvider', () => {
  it('should render children', () => {
    render(
      <FileContextProvider>
        <div data-testid="child">Hello</div>
      </FileContextProvider>,
    )

    expect(screen.getByTestId('child')).toBeInTheDocument()
  })

  it('should provide a store to children', () => {
    const TestChild = () => {
      const files = useStore(s => s.files)
      return <div data-testid="files">{files.length}</div>
    }

    render(
      <FileContextProvider>
        <TestChild />
      </FileContextProvider>,
    )

    expect(screen.getByTestId('files')).toHaveTextContent('0')
  })

  it('should initialize store with value prop', () => {
    const files = [createMockFile()]
    const TestChild = () => {
      const storeFiles = useStore(s => s.files)
      return <div data-testid="files">{storeFiles.length}</div>
    }

    render(
      <FileContextProvider value={files}>
        <TestChild />
      </FileContextProvider>,
    )

    expect(screen.getByTestId('files')).toHaveTextContent('1')
  })

  it('should reuse store on re-render instead of creating a new one', () => {
    const TestChild = () => {
      const storeFiles = useStore(s => s.files)
      return <div data-testid="files">{storeFiles.length}</div>
    }

    const { rerender } = render(
      <FileContextProvider>
        <TestChild />
      </FileContextProvider>,
    )

    expect(screen.getByTestId('files')).toHaveTextContent('0')

    // Re-render with new value prop - store should be reused (storeRef.current exists)
    rerender(
      <FileContextProvider value={[createMockFile()]}>
        <TestChild />
      </FileContextProvider>,
    )

    // Store was created once on first render, so the value prop change won't create a new store
    // The files count should still be 0 since storeRef.current is already set
    expect(screen.getByTestId('files')).toHaveTextContent('0')
  })
})
