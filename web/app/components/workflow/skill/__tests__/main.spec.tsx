import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'

import SkillMain from '../main'

const mocks = vi.hoisted(() => ({
  queryFileId: null as string | null,
  appId: 'app-1',
  activeTabId: 'file-tab',
  openTab: vi.fn(),
  useSkillAutoSave: vi.fn(),
}))

vi.mock('nuqs', () => ({
  parseAsString: 'parseAsString',
  useQueryState: () => [mocks.queryFileId, vi.fn()],
}))

vi.mock('@/app/components/app/store', () => ({
  useStore: (selector: (state: { appDetail: { id: string } | null }) => unknown) => selector({
    appDetail: mocks.appId ? { id: mocks.appId } : null,
  }),
}))

vi.mock('@/app/components/workflow/store', () => ({
  useStore: (selector: (state: { activeTabId: string }) => unknown) => selector({
    activeTabId: mocks.activeTabId,
  }),
  useWorkflowStore: () => ({
    getState: () => ({
      openTab: mocks.openTab,
    }),
  }),
}))

vi.mock('../hooks/use-skill-auto-save', () => ({
  useSkillAutoSave: () => mocks.useSkillAutoSave(),
}))

vi.mock('../hooks/use-skill-save-manager', () => ({
  SkillSaveProvider: ({ appId, children }: { appId: string, children: ReactNode }) => (
    <div data-testid="skill-save-provider" data-app-id={appId}>
      {children}
    </div>
  ),
}))

vi.mock('../constants', () => ({
  isArtifactTab: (tabId: string | null | undefined) => tabId === 'artifact-tab',
}))

vi.mock('../file-tree/artifacts/artifacts-section', () => ({
  default: () => <div data-testid="artifacts-section" />,
}))

vi.mock('../file-tree/tree/file-tree', () => ({
  default: () => <div data-testid="file-tree" />,
}))

vi.mock('../skill-body/layout/content-area', () => ({
  default: ({ children }: { children: ReactNode }) => <div data-testid="content-area">{children}</div>,
}))

vi.mock('../skill-body/layout/content-body', () => ({
  default: ({ children }: { children: ReactNode }) => <div data-testid="content-body">{children}</div>,
}))

vi.mock('../skill-body/layout/sidebar', () => ({
  default: ({ children }: { children: ReactNode }) => <aside data-testid="sidebar">{children}</aside>,
}))

vi.mock('../skill-body/layout/skill-page-layout', () => ({
  default: ({ children }: { children: ReactNode }) => <section data-testid="page-layout">{children}</section>,
}))

vi.mock('../skill-body/panels/artifact-content-panel', () => ({
  default: () => <div data-testid="artifact-content-panel" />,
}))

vi.mock('../skill-body/panels/file-content-panel', () => ({
  default: () => <div data-testid="file-content-panel" />,
}))

vi.mock('../skill-body/sidebar-search-add', () => ({
  default: () => <div data-testid="sidebar-search-add" />,
}))

vi.mock('../skill-body/tabs/file-tabs', () => ({
  default: () => <div data-testid="file-tabs" />,
}))

describe('SkillMain', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.queryFileId = null
    mocks.appId = 'app-1'
    mocks.activeTabId = 'file-tab'
  })

  it('should render the skill layout and autosave manager', () => {
    render(<SkillMain />)

    expect(screen.getByTestId('skill-save-provider')).toHaveAttribute('data-app-id', 'app-1')
    expect(screen.getByTestId('sidebar')).toBeInTheDocument()
    expect(screen.getByTestId('content-area')).toBeInTheDocument()
    expect(screen.getByTestId('file-content-panel')).toBeInTheDocument()
    expect(mocks.useSkillAutoSave).toHaveBeenCalledTimes(1)
  })

  it('should render the artifact content panel when the active tab is an artifact', () => {
    mocks.activeTabId = 'artifact-tab'

    render(<SkillMain />)

    expect(screen.getByTestId('artifact-content-panel')).toBeInTheDocument()
    expect(screen.queryByTestId('file-content-panel')).not.toBeInTheDocument()
  })

  it('should open the query-selected file as a pinned tab', () => {
    mocks.queryFileId = 'file-42'

    render(<SkillMain />)

    expect(mocks.openTab).toHaveBeenCalledWith('file-42', { pinned: true })
  })

  it('should fall back to an empty app id when app detail is missing', () => {
    mocks.appId = ''

    render(<SkillMain />)

    expect(screen.getByTestId('skill-save-provider')).toHaveAttribute('data-app-id', '')
  })
})
