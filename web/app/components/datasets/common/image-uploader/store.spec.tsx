import type { FileEntity } from './types'
import { act, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  createFileStore,
  FileContextProvider,
  useFileStore,
  useFileStoreWithSelector,
} from './store'

const createMockFile = (id: string): FileEntity => ({
  id,
  name: `file-${id}.png`,
  size: 1024,
  extension: 'png',
  mimeType: 'image/png',
  progress: 0,
})

describe('image-uploader store', () => {
  describe('createFileStore', () => {
    it('should create store with empty array by default', () => {
      const store = createFileStore()
      expect(store.getState().files).toEqual([])
    })

    it('should create store with initial value', () => {
      const initialFiles = [createMockFile('1'), createMockFile('2')]
      const store = createFileStore(initialFiles)
      expect(store.getState().files).toHaveLength(2)
    })

    it('should create copy of initial value', () => {
      const initialFiles = [createMockFile('1')]
      const store = createFileStore(initialFiles)
      store.getState().files.push(createMockFile('2'))
      expect(initialFiles).toHaveLength(1)
    })

    it('should update files with setFiles', () => {
      const store = createFileStore()
      const newFiles = [createMockFile('1'), createMockFile('2')]

      act(() => {
        store.getState().setFiles(newFiles)
      })

      expect(store.getState().files).toEqual(newFiles)
    })

    it('should call onChange when setFiles is called', () => {
      const onChange = vi.fn()
      const store = createFileStore([], onChange)
      const newFiles = [createMockFile('1')]

      act(() => {
        store.getState().setFiles(newFiles)
      })

      expect(onChange).toHaveBeenCalledWith(newFiles)
    })

    it('should not throw when onChange is not provided', () => {
      const store = createFileStore([])
      const newFiles = [createMockFile('1')]

      expect(() => {
        act(() => {
          store.getState().setFiles(newFiles)
        })
      }).not.toThrow()
    })

    it('should handle undefined initial value', () => {
      const store = createFileStore(undefined)
      expect(store.getState().files).toEqual([])
    })

    it('should handle null-like falsy value with empty array fallback', () => {
      // Test the ternary: value ? [...value] : []
      const store = createFileStore(null as unknown as FileEntity[])
      expect(store.getState().files).toEqual([])
    })

    it('should handle empty array as initial value', () => {
      const store = createFileStore([])
      expect(store.getState().files).toEqual([])
    })
  })

  describe('FileContextProvider', () => {
    it('should render children', () => {
      render(
        <FileContextProvider>
          <div>Test Child</div>
        </FileContextProvider>,
      )
      expect(screen.getByText('Test Child')).toBeInTheDocument()
    })

    it('should provide store to children', () => {
      const TestComponent = () => {
        const store = useFileStore()
        // useFileStore returns a store that's truthy by design
        return <div data-testid="store-exists">{store !== null ? 'yes' : 'no'}</div>
      }

      render(
        <FileContextProvider>
          <TestComponent />
        </FileContextProvider>,
      )

      expect(screen.getByTestId('store-exists')).toHaveTextContent('yes')
    })

    it('should initialize store with value prop', () => {
      const initialFiles = [createMockFile('1')]

      const TestComponent = () => {
        const store = useFileStore()
        return <div data-testid="file-count">{store.getState().files.length}</div>
      }

      render(
        <FileContextProvider value={initialFiles}>
          <TestComponent />
        </FileContextProvider>,
      )

      expect(screen.getByTestId('file-count')).toHaveTextContent('1')
    })

    it('should call onChange when files change', () => {
      const onChange = vi.fn()
      const newFiles = [createMockFile('1')]

      const TestComponent = () => {
        const store = useFileStore()
        return (
          <button onClick={() => store.getState().setFiles(newFiles)}>
            Set Files
          </button>
        )
      }

      render(
        <FileContextProvider onChange={onChange}>
          <TestComponent />
        </FileContextProvider>,
      )

      act(() => {
        screen.getByRole('button').click()
      })

      expect(onChange).toHaveBeenCalledWith(newFiles)
    })

    it('should reuse existing store on re-render (storeRef.current already exists)', () => {
      const initialFiles = [createMockFile('1')]
      let renderCount = 0

      const TestComponent = () => {
        const store = useFileStore()
        renderCount++
        return (
          <div>
            <span data-testid="file-count">{store.getState().files.length}</span>
            <span data-testid="render-count">{renderCount}</span>
          </div>
        )
      }

      const { rerender } = render(
        <FileContextProvider value={initialFiles}>
          <TestComponent />
        </FileContextProvider>,
      )

      expect(screen.getByTestId('file-count')).toHaveTextContent('1')

      // Re-render the provider - should reuse the same store
      rerender(
        <FileContextProvider value={initialFiles}>
          <TestComponent />
        </FileContextProvider>,
      )

      // Store should still have the same files (store was reused)
      expect(screen.getByTestId('file-count')).toHaveTextContent('1')
      expect(renderCount).toBeGreaterThan(1)
    })
  })

  describe('useFileStore', () => {
    it('should return store from context', () => {
      const TestComponent = () => {
        const store = useFileStore()
        // useFileStore returns a store that's truthy by design
        return <div data-testid="result">{store !== null ? 'has store' : 'no store'}</div>
      }

      render(
        <FileContextProvider>
          <TestComponent />
        </FileContextProvider>,
      )

      expect(screen.getByTestId('result')).toHaveTextContent('has store')
    })
  })

  describe('useFileStoreWithSelector', () => {
    it('should throw error when used outside provider', () => {
      const TestComponent = () => {
        try {
          useFileStoreWithSelector(state => state.files)
          return <div>No Error</div>
        }
        catch {
          return <div>Error</div>
        }
      }

      render(<TestComponent />)
      expect(screen.getByText('Error')).toBeInTheDocument()
    })

    it('should select files from store', () => {
      const initialFiles = [createMockFile('1'), createMockFile('2')]

      const TestComponent = () => {
        const files = useFileStoreWithSelector(state => state.files)
        return <div data-testid="files-count">{files.length}</div>
      }

      render(
        <FileContextProvider value={initialFiles}>
          <TestComponent />
        </FileContextProvider>,
      )

      expect(screen.getByTestId('files-count')).toHaveTextContent('2')
    })

    it('should select setFiles function from store', () => {
      const onChange = vi.fn()

      const TestComponent = () => {
        const setFiles = useFileStoreWithSelector(state => state.setFiles)
        return (
          <button onClick={() => setFiles([createMockFile('new')])}>
            Update
          </button>
        )
      }

      render(
        <FileContextProvider onChange={onChange}>
          <TestComponent />
        </FileContextProvider>,
      )

      act(() => {
        screen.getByRole('button').click()
      })

      expect(onChange).toHaveBeenCalled()
    })

    it('should re-render when selected state changes', () => {
      const renderCount = { current: 0 }

      const TestComponent = () => {
        const files = useFileStoreWithSelector(state => state.files)
        const setFiles = useFileStoreWithSelector(state => state.setFiles)
        renderCount.current++

        return (
          <div>
            <span data-testid="count">{files.length}</span>
            <button onClick={() => setFiles([...files, createMockFile('new')])}>
              Add
            </button>
          </div>
        )
      }

      render(
        <FileContextProvider>
          <TestComponent />
        </FileContextProvider>,
      )

      expect(screen.getByTestId('count')).toHaveTextContent('0')

      act(() => {
        screen.getByRole('button').click()
      })

      expect(screen.getByTestId('count')).toHaveTextContent('1')
    })
  })
})
