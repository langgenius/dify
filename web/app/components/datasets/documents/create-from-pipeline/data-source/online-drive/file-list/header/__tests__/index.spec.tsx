import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import Header from '../index'

const mockStoreState = {
  hasBucket: false,
  setOnlineDriveFileList: vi.fn(),
  setSelectedFileIds: vi.fn(),
  setBreadcrumbs: vi.fn(),
  setPrefix: vi.fn(),
  setBucket: vi.fn(),
  breadcrumbs: [],
  prefix: [],
}

const mockDataSourceStore = { getState: vi.fn(() => mockStoreState) }

vi.mock('../../../../store', () => ({
  useDataSourceStore: () => mockDataSourceStore,
  useDataSourceStoreWithSelector: (selector: (state: typeof mockStoreState) => unknown) =>
    selector(mockStoreState),
}))

type HeaderProps = React.ComponentProps<typeof Header>

const createDefaultProps = (overrides?: Partial<HeaderProps>): HeaderProps => ({
  breadcrumbs: [],
  inputValue: '',
  keywords: '',
  bucket: '',
  searchResultsLength: 0,
  onSearchValueChange: vi.fn(),
  isInPipeline: false,
  ...overrides,
})

const searchName = 'datasetPipeline.onlineDrive.breadcrumbs.searchPlaceholder'

const ControlledHeader = ({
  initialValue = '',
  onSearchValueChange,
}: {
  initialValue?: string
  onSearchValueChange: (value: string) => void
}) => {
  const [inputValue, setInputValue] = React.useState(initialValue)

  return (
    <Header
      {...createDefaultProps()}
      inputValue={inputValue}
      onSearchValueChange={(value) => {
        setInputValue(value)
        onSearchValueChange(value)
      }}
    />
  )
}

describe('Header', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the current query as a labeled searchbox', () => {
    render(<Header {...createDefaultProps({ inputValue: 'report' })} />)

    expect(screen.getByRole('searchbox', { name: searchName })).toHaveValue('report')
  })

  it('reports the edited search value', async () => {
    const user = userEvent.setup()
    const onSearchValueChange = vi.fn()
    render(<ControlledHeader onSearchValueChange={onSearchValueChange} />)

    await user.type(screen.getByRole('searchbox', { name: searchName }), 'report')

    expect(onSearchValueChange).toHaveBeenLastCalledWith('report')
  })

  it('clears the query and returns focus to the searchbox', async () => {
    const user = userEvent.setup()
    const onSearchValueChange = vi.fn()
    render(<ControlledHeader initialValue="report" onSearchValueChange={onSearchValueChange} />)

    await user.click(screen.getByRole('button', { name: 'common.operation.clear' }))

    const searchbox = screen.getByRole('searchbox', { name: searchName })
    expect(onSearchValueChange).toHaveBeenLastCalledWith('')
    expect(searchbox).toHaveValue('')
    expect(searchbox).toHaveFocus()
  })
})
