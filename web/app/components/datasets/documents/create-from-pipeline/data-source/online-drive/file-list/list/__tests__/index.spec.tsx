import type { ComponentProps } from 'react'
import type { OnlineDriveFile } from '@/models/pipeline'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { OnlineDriveFileType } from '@/models/pipeline'
import { createDataSourceStore } from '../../../../store'
import { DataSourceContext } from '../../../../store/provider'
import List from '../index'

const files: OnlineDriveFile[] = [
  { id: 'first', name: 'First.pdf', type: OnlineDriveFileType.file, size: 1024 },
  { id: 'second', name: 'Second.txt', type: OnlineDriveFileType.file, size: 512 },
  { id: 'folder', name: 'Archive', type: OnlineDriveFileType.folder },
]
const observers: Observer[] = []
class Observer implements IntersectionObserver {
  readonly root = null
  readonly rootMargin = '100px'
  readonly scrollMargin = '0px'
  readonly thresholds = [0]
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
  takeRecords = () => []
  private callback: IntersectionObserverCallback
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback
    observers.push(this)
  }
  intersect(visible: boolean) {
    const target = this.observe.mock.lastCall![0] as Element
    const rect = target.getBoundingClientRect()
    this.callback(
      [
        {
          isIntersecting: visible,
          intersectionRatio: visible ? 1 : 0,
          target,
          time: 0,
          rootBounds: null,
          boundingClientRect: rect,
          intersectionRect: rect,
        },
      ],
      this,
    )
  }
}
function setup(overrides: Partial<ComponentProps<typeof List>> = {}) {
  const store = createDataSourceStore()
  const props = {
    fileList: files,
    selectedFileIds: ['first'],
    keywords: '',
    isLoading: false,
    supportBatchUpload: true,
    handleResetKeywords: vi.fn(),
    handleSelectFile: vi.fn(),
    handleOpenFolder: vi.fn(),
    ...overrides,
  }
  const view = render(
    <DataSourceContext value={store}>
      <List {...props} />
    </DataSourceContext>,
  )
  return {
    ...view,
    store,
    props,
    update: (next: Partial<typeof props>) =>
      view.rerender(
        <DataSourceContext value={store}>
          <List {...props} {...next} />
        </DataSourceContext>,
      ),
  }
}
beforeEach(() => {
  observers.length = 0
  vi.stubGlobal('IntersectionObserver', Observer)
})
afterEach(() => vi.unstubAllGlobals())

it.each([true, false])('reflects and updates selected files in batch=%s mode', async (multiple) => {
  const user = userEvent.setup()
  const { props, update } = setup({ supportBatchUpload: multiple })
  const role = multiple ? 'checkbox' : 'radio'
  expect(screen.getByRole(role, { name: 'First.pdf' })).toBeChecked()
  expect(screen.getByRole(role, { name: 'Second.txt' })).not.toBeChecked()
  await user.click(screen.getByRole(role, { name: 'Second.txt' }))
  expect(props.handleSelectFile).toHaveBeenCalledExactlyOnceWith(files[1])
  expect(props.handleOpenFolder).not.toHaveBeenCalled()
  update({ selectedFileIds: ['second'] })
  expect(screen.getByRole(role, { name: 'First.pdf' })).not.toBeChecked()
  expect(screen.getByRole(role, { name: 'Second.txt' })).toBeChecked()
})

it('opens a folder without selecting it', async () => {
  const user = userEvent.setup()
  const { props } = setup()
  await user.click(screen.getByText('Archive'))
  expect(props.handleOpenFolder).toHaveBeenCalledExactlyOnceWith(files[2])
  expect(props.handleSelectFile).not.toHaveBeenCalled()
})

it('distinguishes an empty folder from a failed search and allows resetting the search', async () => {
  const user = userEvent.setup()
  const { update, props } = setup({ fileList: [], isLoading: true })
  expect(screen.queryByText('datasetPipeline.onlineDrive.emptyFolder')).not.toBeInTheDocument()
  update({ fileList: [], isLoading: false })
  expect(screen.getByText('datasetPipeline.onlineDrive.emptyFolder')).toBeInTheDocument()
  update({ fileList: [], keywords: 'missing', isLoading: false })
  expect(screen.getByText('datasetPipeline.onlineDrive.emptySearchResult')).toBeInTheDocument()
  expect(screen.queryByText('datasetPipeline.onlineDrive.emptyFolder')).not.toBeInTheDocument()
  await user.click(
    screen.getByRole('button', { name: 'datasetPipeline.onlineDrive.resetKeywords' }),
  )
  expect(props.handleResetKeywords).toHaveBeenCalledOnce()
})

it('keeps loaded files visible while loading more and displays the appended page', () => {
  const { update } = setup({ isLoading: true })
  expect(screen.getByRole('checkbox', { name: 'First.pdf' })).toBeInTheDocument()
  expect(screen.getByRole('status', { name: 'appApi.loading' })).toBeInTheDocument()
  update({
    isLoading: false,
    fileList: [...files, { id: 'third', name: 'Third.pdf', type: OnlineDriveFileType.file }],
  })
  expect(screen.queryByRole('status', { name: 'appApi.loading' })).not.toBeInTheDocument()
  expect(screen.getByRole('checkbox', { name: 'Third.pdf' })).toBeInTheDocument()
})

it.each([
  {
    visible: true,
    truncated: true,
    loading: false,
    expected: { cursor: 'next', bucket: 'archive' },
  },
  { visible: false, truncated: true, loading: false, expected: {} },
  { visible: true, truncated: false, loading: false, expected: {} },
  { visible: true, truncated: true, loading: true, expected: {} },
])(
  'loads another page only when visible, truncated, and idle: %j',
  ({ visible, truncated, loading, expected }) => {
    const { store } = setup({ isLoading: loading })
    store.getState().isTruncated.current = truncated
    store.getState().currentNextPageParametersRef.current = { cursor: 'next', bucket: 'archive' }
    act(() => observers[0]!.intersect(visible))
    expect(store.getState().nextPageParameters).toEqual(expected)
  },
)

it('replaces the observer when loading changes and disconnects the current observer on unmount', () => {
  const { update, unmount, store } = setup({ isLoading: true })
  const first = observers[0]!
  update({ isLoading: false })
  expect(first.disconnect).toHaveBeenCalledOnce()
  const current = observers[1]!
  store.getState().isTruncated.current = true
  store.getState().currentNextPageParametersRef.current = { cursor: 'latest' }
  act(() => current.intersect(true))
  expect(store.getState().nextPageParameters).toEqual({ cursor: 'latest' })
  unmount()
  expect(current.disconnect).toHaveBeenCalledOnce()
})
