import type { ComponentProps } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Breadcrumbs from '../index'

const store = {
  hasBucket: false,
  breadcrumbs: [] as string[],
  prefix: [] as string[],
  setOnlineDriveFileList: vi.fn(),
  setSelectedFileIds: vi.fn(),
  setBreadcrumbs: vi.fn(),
  setPrefix: vi.fn(),
  setBucket: vi.fn(),
}

vi.mock('../../../../../store', () => ({
  useDataSourceStore: () => ({ getState: () => store }),
  useDataSourceStoreWithSelector: (selector: (state: typeof store) => unknown) => selector(store),
}))

function renderPath(overrides: Partial<ComponentProps<typeof Breadcrumbs>> = {}) {
  const props = {
    breadcrumbs: ['Documents', 'Reports'],
    keywords: '',
    bucket: '',
    searchResultsLength: 0,
    isInPipeline: false,
    ...overrides,
  }
  store.breadcrumbs = props.breadcrumbs
  store.prefix = props.breadcrumbs.map((_, index) => `prefix-${index}`)
  return render(<Breadcrumbs {...props} />)
}

const allFiles = 'datasetPipeline.onlineDrive.breadcrumbs.allFiles'
const allBuckets = 'datasetPipeline.onlineDrive.breadcrumbs.allBuckets'

beforeEach(() => {
  vi.clearAllMocks()
  store.hasBucket = false
  store.breadcrumbs = []
  store.prefix = []
})

it('exposes path items without counting decorative separators and marks the current directory', async () => {
  const user = userEvent.setup()
  renderPath()
  const path = within(screen.getByRole('navigation', { name: allFiles }))
  expect(path.getAllByRole('listitem')).toHaveLength(3)
  const current = path.getByRole('button', { name: 'Reports' })
  expect(current).toHaveAttribute('aria-current', 'location')
  expect(current).toBeDisabled()
  await user.click(current)
  expect(store.setBreadcrumbs).not.toHaveBeenCalled()

  await user.click(path.getByRole('button', { name: 'Documents' }))
  expect(store.setBreadcrumbs).toHaveBeenCalledWith(['Documents'])
  expect(store.setPrefix).toHaveBeenCalledWith(['prefix-0'])
  expect(store.setOnlineDriveFileList).toHaveBeenCalledWith([])
  expect(store.setSelectedFileIds).toHaveBeenCalledWith([])
})

it('returns to the drive root and disables root navigation once already there', async () => {
  const user = userEvent.setup()
  const { rerender } = renderPath()
  await user.click(screen.getByRole('button', { name: allFiles }))
  expect(store.setBreadcrumbs).toHaveBeenCalledWith([])
  expect(store.setPrefix).toHaveBeenCalledWith([])
  expect(store.setOnlineDriveFileList).toHaveBeenCalledWith([])
  expect(store.setSelectedFileIds).toHaveBeenCalledWith([])

  rerender(
    <Breadcrumbs
      breadcrumbs={[]}
      keywords=""
      bucket=""
      searchResultsLength={0}
      isInPipeline={false}
    />,
  )
  expect(screen.getAllByRole('listitem')).toHaveLength(1)
  expect(screen.getByRole('button', { name: allFiles })).toBeDisabled()
  expect(screen.getByRole('button', { name: allFiles })).toHaveAttribute('aria-current', 'location')
})

it('distinguishes returning to the current bucket from leaving it for the bucket list', async () => {
  const user = userEvent.setup()
  store.hasBucket = true
  renderPath({ bucket: 'Storage' })
  await user.click(screen.getByRole('button', { name: 'Storage' }))
  expect(store.setBreadcrumbs).toHaveBeenCalledWith([])
  expect(store.setPrefix).toHaveBeenCalledWith([])
  expect(store.setBucket).not.toHaveBeenCalled()

  await user.click(screen.getByRole('button', { name: allBuckets }))
  expect(store.setBucket).toHaveBeenCalledWith('')
  expect(store.setOnlineDriveFileList).toHaveBeenCalledWith([])
  expect(store.setSelectedFileIds).toHaveBeenCalledWith([])
})

it('keeps the bucket-list action available at the current bucket root', () => {
  store.hasBucket = true
  renderPath({ bucket: 'Storage', breadcrumbs: [] })
  expect(screen.getByRole('button', { name: allBuckets })).toBeEnabled()
  expect(screen.getByRole('button', { name: 'Storage' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Storage' })).toHaveAttribute(
    'aria-current',
    'location',
  )
})

it.each([
  { isInPipeline: false, bucket: '', visiblePrefixes: ['A', 'B'] },
  { isInPipeline: true, bucket: '', visiblePrefixes: ['A'] },
  { isInPipeline: false, bucket: 'Storage', visiblePrefixes: ['A'] },
  { isInPipeline: true, bucket: 'Storage', visiblePrefixes: [] },
])(
  'keeps collapsed paths navigable with pipeline=$isInPipeline and bucket=$bucket',
  async ({ isInPipeline, bucket, visiblePrefixes }) => {
    const user = userEvent.setup()
    store.hasBucket = !!bucket
    renderPath({ breadcrumbs: ['A', 'B', 'C', 'D'], isInPipeline, bucket })
    for (const name of visiblePrefixes)
      expect(screen.getByRole('button', { name })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'C' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'D' })).toHaveAttribute('aria-current', 'location')

    const more = screen.getByRole('button', { name: 'common.operation.more' })
    more.focus()
    await user.keyboard('{Enter}')
    await user.click(await screen.findByRole('menuitem', { name: 'C' }))
    expect(store.setBreadcrumbs).toHaveBeenCalledWith(['A', 'B', 'C'])
    expect(store.setPrefix).toHaveBeenCalledWith(['prefix-0', 'prefix-1', 'prefix-2'])
    expect(more).toHaveFocus()
  },
)

it('shows a bucket-list heading instead of an empty navigation landmark', () => {
  store.hasBucket = true
  renderPath({ breadcrumbs: [] })
  expect(screen.getByText(allBuckets)).toBeInTheDocument()
  expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
})

it.each([
  { breadcrumbs: [], bucket: 'Storage', folderName: 'Storage' },
  { breadcrumbs: ['Documents', 'Reports'], bucket: 'Storage', folderName: 'Reports' },
])(
  'replaces the path with search results scoped to $folderName',
  ({ breadcrumbs, bucket, folderName }) => {
    renderPath({ breadcrumbs, bucket, keywords: 'query', searchResultsLength: 5 })
    expect(screen.getByText(/onlineDrive.breadcrumbs.searchResult/)).toHaveTextContent(folderName)
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
  },
)

it('keeps the directory path available when a search has no results', () => {
  renderPath({ keywords: 'query', searchResultsLength: 0 })
  expect(screen.getByRole('navigation', { name: allFiles })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Reports' })).toHaveAttribute(
    'aria-current',
    'location',
  )
})
