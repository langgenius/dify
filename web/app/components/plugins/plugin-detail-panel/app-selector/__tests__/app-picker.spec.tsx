import type { AppPartial } from '@dify/contracts/api/console/apps/types.gen'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { AppModeEnum } from '@/types/app'
import { AppPicker } from '../app-picker'

vi.mock('@/app/components/base/app-icon', () => ({
  default: () => <span aria-hidden="true" data-testid="app-icon" />,
}))

const app = {
  id: 'app-1',
  name: 'Workflow App',
  mode: AppModeEnum.WORKFLOW,
  icon_type: 'emoji',
  icon: 'W',
  icon_background: '#FFFFFF',
  icon_url: null,
} satisfies AppPartial

function renderAppPicker(
  overrides: Partial<Omit<React.ComponentProps<typeof AppPicker>, 'isShow' | 'onShowChange'>> = {},
) {
  const props = {
    disabled: false,
    trigger: <span>Choose app</span>,
    onSelect: vi.fn(),
    apps: [app],
    isLoading: false,
    hasMore: false,
    onLoadMore: vi.fn(),
    searchText: '',
    onSearchChange: vi.fn(),
    ...overrides,
  }

  function AppPickerHarness() {
    const [open, setOpen] = useState(false)

    return <AppPicker {...props} isShow={open} onShowChange={setOpen} />
  }

  return { props, ...render(<AppPickerHarness />) }
}

describe('AppPicker', () => {
  it('should expose a named dialog and keep app choices in the listbox', async () => {
    const user = userEvent.setup()
    renderAppPicker()
    await user.click(screen.getByRole('combobox', { name: 'app.appSelector.label' }))

    const dialog = screen.getByRole('dialog', { name: 'app.appSelector.label' })
    const listbox = screen.getByRole('listbox')
    const option = screen.getByRole('option', { name: /Workflow App/ })

    expect(dialog).toBeInTheDocument()
    expect(listbox).toContainElement(option)
  })

  it('should not show the empty state while loading', async () => {
    const user = userEvent.setup()
    renderAppPicker({ apps: [], isLoading: true })
    await user.click(screen.getByRole('combobox', { name: 'app.appSelector.label' }))

    expect(
      screen
        .getAllByRole('status')
        .some((status) => status.textContent?.includes('common.loading')),
    ).toBe(true)
    expect(screen.queryByText('common.noData')).not.toBeInTheDocument()
  })

  it('should keep load more outside the listbox and inside the named scroll region', async () => {
    const user = userEvent.setup()
    renderAppPicker({ hasMore: true })
    await user.click(screen.getByRole('combobox', { name: 'app.appSelector.label' }))

    const listbox = screen.getByRole('listbox')
    const scrollRegion = screen.getByRole('region', { name: 'app.appSelector.label' })
    const loadMoreButton = screen.getByRole('button', { name: 'workflow.common.loadMore' })

    expect(listbox).not.toContainElement(loadMoreButton)
    expect(scrollRegion).toContainElement(listbox)
    expect(scrollRegion).toContainElement(loadMoreButton)
  })

  it('should clear only the search query and keep focus in the input', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()

    function AppPickerHarness() {
      const [open, setOpen] = useState(false)
      const [searchText, setSearchText] = useState('')

      return (
        <AppPicker
          disabled={false}
          trigger={<span>Choose app</span>}
          isShow={open}
          onShowChange={setOpen}
          onSelect={onSelect}
          apps={[app]}
          isLoading={false}
          hasMore={false}
          onLoadMore={vi.fn()}
          searchText={searchText}
          onSearchChange={setSearchText}
        />
      )
    }

    render(<AppPickerHarness />)
    await user.click(screen.getByRole('combobox', { name: 'app.appSelector.label' }))
    const searchInput = screen.getByRole('combobox', { name: 'app.appSelector.placeholder' })
    await user.type(searchInput, 'workflow')
    const clearButton = screen.getByRole('button', { name: 'common.operation.clear' })
    clearButton.focus()
    await user.keyboard('{Enter}')

    expect(searchInput).toHaveValue('')
    expect(searchInput).toHaveFocus()
    expect(onSelect).not.toHaveBeenCalled()
    expect(screen.getByRole('option', { name: /Workflow App/ })).toBeInTheDocument()
  })
})
