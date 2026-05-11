import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Nav from '@/app/components/header/nav'
import { AppModeEnum } from '@/types/app'

const mockPush = vi.fn()
const mockSetAppDetail = vi.fn()
const mockOnCreate = vi.fn()
const mockOnLoadMore = vi.fn()

let mockSelectedSegment = 'app'
let mockIsCurrentWorkspaceEditor = true

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@/next/navigation', () => ({
  useSelectedLayoutSegment: () => mockSelectedSegment,
  useRouter: () => ({
    push: mockPush,
  }),
}))

vi.mock('@/next/link', () => ({
  default: ({
    href,
    children,
  }: {
    href: string
    children?: React.ReactNode
  }) => <a href={href}>{children}</a>,
}))

vi.mock('@/app/components/app/store', () => ({
  useStore: () => mockSetAppDetail,
}))

vi.mock('@/context/app-context', () => ({
  useAppContext: () => ({
    isCurrentWorkspaceEditor: mockIsCurrentWorkspaceEditor,
  }),
}))

const navigationItems = [
  {
    id: 'app-1',
    name: 'Alpha',
    link: '/app/app-1/configuration',
    icon_type: 'emoji' as const,
    icon: '🤖',
    icon_background: '#FFEAD5',
    icon_url: null,
    mode: AppModeEnum.CHAT,
  },
  {
    id: 'app-2',
    name: 'Bravo',
    link: '/app/app-2/workflow',
    icon_type: 'emoji' as const,
    icon: '⚙️',
    icon_background: '#E0F2FE',
    icon_url: null,
    mode: AppModeEnum.WORKFLOW,
  },
]

const curNav = {
  id: 'app-1',
  name: 'Alpha',
  icon_type: 'emoji' as const,
  icon: '🤖',
  icon_background: '#FFEAD5',
  icon_url: null,
  mode: AppModeEnum.CHAT,
}

const renderNav = (nav = curNav) => {
  return render(
    <Nav
      isApp
      icon={<span data-testid="nav-icon">icon</span>}
      activeIcon={<span data-testid="nav-icon-active">active-icon</span>}
      text="menus.apps"
      activeSegment={['apps', 'app']}
      link="/apps"
      curNav={nav}
      navigationItems={navigationItems}
      createText="menus.newApp"
      onCreate={mockOnCreate}
      onLoadMore={mockOnLoadMore}
      isLoadingMore={false}
    />,
  )
}

describe('Header Nav Flow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSelectedSegment = 'app'
    mockIsCurrentWorkspaceEditor = true
  })

  it('switches to another app from the selector and clears stale app detail first', async () => {
    renderNav()

    fireEvent.click(screen.getByRole('button', { name: /Alpha/i }))
    fireEvent.click(await screen.findByText('Bravo'))

    expect(mockSetAppDetail).toHaveBeenCalled()
    expect(mockPush).toHaveBeenCalledWith('/app/app-2/workflow')
  })

  it('opens the nested create menu and emits all app creation branches', async () => {
    const user = userEvent.setup()
    const clickCreateBranch = async (optionName: string) => {
      const { unmount } = renderNav()
      await user.click(screen.getByRole('button', { name: /Alpha/i }))
      await user.hover(await screen.findByRole('menuitem', { name: /menus\.newApp/i }))
      fireEvent.click(await screen.findByRole('menuitem', { name: optionName }))
      unmount()
    }

    await clickCreateBranch('newApp.startFromBlank')
    await clickCreateBranch('newApp.startFromTemplate')
    await clickCreateBranch('importDSL')

    expect(mockOnCreate).toHaveBeenNthCalledWith(1, 'blank')
    expect(mockOnCreate).toHaveBeenNthCalledWith(2, 'template')
    expect(mockOnCreate).toHaveBeenNthCalledWith(3, 'dsl')
    expect(mockOnCreate).toHaveBeenCalledTimes(3)
  })

  it('keeps the current nav label in sync with prop updates', async () => {
    const { rerender } = renderNav()

    expect(screen.getByRole('button', { name: /Alpha/i })).toBeInTheDocument()

    rerender(
      <Nav
        isApp
        icon={<span data-testid="nav-icon">icon</span>}
        activeIcon={<span data-testid="nav-icon-active">active-icon</span>}
        text="menus.apps"
        activeSegment={['apps', 'app']}
        link="/apps"
        curNav={{
          ...curNav,
          name: 'Alpha Renamed',
        }}
        navigationItems={navigationItems}
        createText="menus.newApp"
        onCreate={mockOnCreate}
        onLoadMore={mockOnLoadMore}
        isLoadingMore={false}
      />,
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Alpha Renamed/i })).toBeInTheDocument()
    })
  })
})
