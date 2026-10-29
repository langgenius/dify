import type { ComponentProps } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createDataSourceStore } from '../../../../../store'
import { DataSourceContext } from '../../../../../store/provider'
import Breadcrumbs from '../index'

let store = createDataSourceStore()

function renderPath(overrides: Partial<ComponentProps<typeof Breadcrumbs>> = {}) {
  const props = {
    breadcrumbs: ['Documents', 'Reports'],
    keywords: '',
    bucket: '',
    searchResultsLength: 0,
    isInPipeline: false,
    ...overrides,
  }
  store.setState({
    breadcrumbs: props.breadcrumbs,
    prefix: props.breadcrumbs.map((_, index) => `prefix-${index}`),
    bucket: props.bucket,
    selectedFileIds: ['selected-file'],
    onlineDriveFileList: [{ id: 'selected-file', name: 'report.txt', type: 'file', size: 10 }],
  })
  return render(<Breadcrumbs {...props} />, {
    wrapper: ({ children }) => <DataSourceContext value={store}>{children}</DataSourceContext>,
  })
}

const allFiles = 'datasetPipeline.onlineDrive.breadcrumbs.allFiles'
const allBuckets = 'datasetPipeline.onlineDrive.breadcrumbs.allBuckets'

beforeEach(() => {
  store = createDataSourceStore()
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
  expect(store.getState().breadcrumbs).toEqual(['Documents', 'Reports'])

  await user.click(path.getByRole('button', { name: 'Documents' }))
  expect(store.getState().breadcrumbs).toEqual(['Documents'])
  expect(store.getState().prefix).toEqual(['prefix-0'])
  expect(store.getState().onlineDriveFileList).toEqual([])
  expect(store.getState().selectedFileIds).toEqual([])
})

it('returns to the drive root and disables root navigation once already there', async () => {
  const user = userEvent.setup()
  const { rerender } = renderPath()
  await user.click(screen.getByRole('button', { name: allFiles }))
  expect(store.getState().breadcrumbs).toEqual([])
  expect(store.getState().prefix).toEqual([])
  expect(store.getState().onlineDriveFileList).toEqual([])
  expect(store.getState().selectedFileIds).toEqual([])

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
  store.setState({ hasBucket: true })
  renderPath({ bucket: 'Storage' })
  await user.click(screen.getByRole('button', { name: 'Storage' }))
  expect(store.getState().breadcrumbs).toEqual([])
  expect(store.getState().prefix).toEqual([])
  expect(store.getState().bucket).toBe('Storage')

  await user.click(screen.getByRole('button', { name: allBuckets }))
  expect(store.getState().bucket).toEqual('')
  expect(store.getState().onlineDriveFileList).toEqual([])
  expect(store.getState().selectedFileIds).toEqual([])
})

it('keeps the bucket-list action available at the current bucket root', () => {
  store.setState({ hasBucket: true })
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
    store.setState({ hasBucket: !!bucket })
    renderPath({ breadcrumbs: ['A', 'B', 'C', 'D'], isInPipeline, bucket })
    for (const name of visiblePrefixes)
      expect(screen.getByRole('button', { name })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'C' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'D' })).toHaveAttribute('aria-current', 'location')

    const more = screen.getByRole('button', { name: 'common.operation.more' })
    more.focus()
    await user.keyboard('{Enter}')
    await user.click(await screen.findByRole('menuitem', { name: 'C' }))
    expect(store.getState().breadcrumbs).toEqual(['A', 'B', 'C'])
    expect(store.getState().prefix).toEqual(['prefix-0', 'prefix-1', 'prefix-2'])
  },
)

it('shows a bucket-list heading instead of an empty navigation landmark', () => {
  store.setState({ hasBucket: true })
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
