import type { ReactNode } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppModeEnum } from '@/types/app'
import AppPicker from '../app-picker'

class MockIntersectionObserver {
  observe = vi.fn()
  disconnect = vi.fn()
  unobserve = vi.fn()
}

class MockMutationObserver {
  observe = vi.fn()
  disconnect = vi.fn()
  takeRecords = vi.fn().mockReturnValue([])
}

beforeAll(() => {
  vi.stubGlobal('IntersectionObserver', MockIntersectionObserver)
  vi.stubGlobal('MutationObserver', MockMutationObserver)
})

vi.mock('@/app/components/base/app-icon', () => ({
  default: () => <div data-testid="app-icon" />,
}))

vi.mock('@/app/components/base/input', () => ({
  default: ({
    value,
    onChange,
    onClear,
  }: {
    value: string
    onChange: (e: { target: { value: string } }) => void
    onClear?: () => void
  }) => (
    <div>
      <input
        data-testid="search-input"
        value={value}
        onChange={e => onChange({ target: { value: e.target.value } })}
      />
      <button data-testid="clear-input" onClick={onClear}>Clear</button>
    </div>
  ),
}))

vi.mock('@/app/components/base/portal-to-follow-elem', () => ({
  PortalToFollowElem: ({
    children,
    open,
  }: {
    children: ReactNode
    open: boolean
  }) => (
    <div data-testid="portal" data-open={open}>
      {children}
    </div>
  ),
  PortalToFollowElemTrigger: ({
    children,
    onClick,
  }: {
    children: ReactNode
    onClick?: () => void
  }) => (
    <button data-testid="picker-trigger" onClick={onClick}>
      {children}
    </button>
  ),
  PortalToFollowElemContent: ({ children }: { children: ReactNode }) => (
    <div data-testid="portal-content">{children}</div>
  ),
}))

const apps = [
  {
    id: 'app-1',
    name: 'Chat App',
    mode: AppModeEnum.CHAT,
    icon_type: 'emoji',
    icon: '🤖',
    icon_background: '#fff',
  },
  {
    id: 'app-2',
    name: 'Workflow App',
    mode: AppModeEnum.WORKFLOW,
    icon_type: 'emoji',
    icon: '⚙️',
    icon_background: '#fff',
  },
]

describe('AppPicker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should open when the trigger is clicked', () => {
    const onShowChange = vi.fn()

    render(
      <AppPicker
        scope="all"
        disabled={false}
        trigger={<span>Trigger</span>}
        isShow={false}
        onShowChange={onShowChange}
        onSelect={vi.fn()}
        apps={apps as never}
        isLoading={false}
        hasMore={false}
        onLoadMore={vi.fn()}
        searchText=""
        onSearchChange={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByTestId('picker-trigger'))

    expect(onShowChange).toHaveBeenCalledWith(true)
  })

  it('should render apps, select one, and handle search changes', () => {
    const onSelect = vi.fn()
    const onSearchChange = vi.fn()

    render(
      <AppPicker
        scope="all"
        disabled={false}
        trigger={<span>Trigger</span>}
        isShow
        onShowChange={vi.fn()}
        onSelect={onSelect}
        apps={apps as never}
        isLoading={false}
        hasMore={false}
        onLoadMore={vi.fn()}
        searchText="chat"
        onSearchChange={onSearchChange}
      />,
    )

    fireEvent.change(screen.getByTestId('search-input'), {
      target: { value: 'workflow' },
    })
    fireEvent.click(screen.getByText('Workflow App'))
    fireEvent.click(screen.getByTestId('clear-input'))

    expect(onSearchChange).toHaveBeenCalledWith('workflow')
    expect(onSearchChange).toHaveBeenCalledWith('')
    expect(onSelect).toHaveBeenCalledWith(apps[1])
    expect(screen.getByText('chat')).toBeInTheDocument()
  })

  it('should render loading text when loading more apps', () => {
    render(
      <AppPicker
        scope="all"
        disabled={false}
        trigger={<span>Trigger</span>}
        isShow
        onShowChange={vi.fn()}
        onSelect={vi.fn()}
        apps={apps as never}
        isLoading
        hasMore
        onLoadMore={vi.fn()}
        searchText=""
        onSearchChange={vi.fn()}
      />,
    )

    expect(screen.getByText('common.loading')).toBeInTheDocument()
  })
})
