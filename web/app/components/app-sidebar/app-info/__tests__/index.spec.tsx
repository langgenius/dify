import type { App, AppSSO } from '@/types/app'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { AppModeEnum } from '@/types/app'
import AppInfo from '..'

let mockIsCurrentWorkspaceEditor = true
const mockSetPanelOpen = vi.fn()

vi.mock('@/context/app-context', () => ({
  useAppContext: () => ({
    isCurrentWorkspaceEditor: mockIsCurrentWorkspaceEditor,
  }),
}))

vi.mock('../app-info-trigger', () => ({
  default: React.memo(({ appDetail, expand, onClick }: {
    appDetail: App & Partial<AppSSO>
    expand: boolean
    onClick: () => void
  }) => (
    <button type="button" data-testid="trigger" data-expand={expand} onClick={onClick}>
      {appDetail.name}
    </button>
  )),
}))

vi.mock('../app-info-detail-panel', () => ({
  default: React.memo(({ show, onClose }: { show: boolean, onClose: () => void }) => (
    show ? <div data-testid="detail-panel"><button type="button" onClick={onClose}>Close Panel</button></div> : null
  )),
}))

vi.mock('../app-info-modals', () => ({
  default: React.memo(({ activeModal }: { activeModal: string | null }) => (
    activeModal ? <div data-testid="modals" data-modal={activeModal} /> : null
  )),
}))

const mockAppDetail: App & Partial<AppSSO> = {
  id: 'app-1',
  name: 'Test App',
  mode: AppModeEnum.CHAT,
  icon: '🤖',
  icon_type: 'emoji',
  icon_background: '#FFEAD5',
  icon_url: '',
  description: '',
  use_icon_as_answer_icon: false,
} as App & Partial<AppSSO>

const mockUseAppInfoActions = {
  appDetail: mockAppDetail,
  panelOpen: false,
  setPanelOpen: mockSetPanelOpen,
  closePanel: vi.fn(),
  activeModal: null as string | null,
  openModal: vi.fn(),
  closeModal: vi.fn(),
  secretEnvList: [],
  setSecretEnvList: vi.fn(),
  onEdit: vi.fn(),
  onCopy: vi.fn(),
  onExport: vi.fn(),
  exportCheck: vi.fn(),
  handleConfirmExport: vi.fn(),
  onConfirmDelete: vi.fn(),
}

vi.mock('../use-app-info-actions', () => ({
  useAppInfoActions: () => mockUseAppInfoActions,
}))

describe('AppInfo', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsCurrentWorkspaceEditor = true
    mockUseAppInfoActions.appDetail = mockAppDetail
    mockUseAppInfoActions.panelOpen = false
    mockUseAppInfoActions.activeModal = null
  })

  it('should return null when appDetail is not available', () => {
    mockUseAppInfoActions.appDetail = undefined as unknown as App & Partial<AppSSO>
    const { container } = render(<AppInfo expand />)
    expect(container.innerHTML).toBe('')
  })

  it('should render trigger when not onlyShowDetail', () => {
    render(<AppInfo expand />)
    expect(screen.getByTestId('trigger'))!.toBeInTheDocument()
  })

  it('should not render trigger when onlyShowDetail is true', () => {
    render(<AppInfo expand onlyShowDetail />)
    expect(screen.queryByTestId('trigger')).not.toBeInTheDocument()
  })

  it('should pass expand prop to trigger', () => {
    render(<AppInfo expand />)
    expect(screen.getByTestId('trigger'))!.toHaveAttribute('data-expand', 'true')

    const { unmount } = render(<AppInfo expand={false} />)
    const triggers = screen.getAllByTestId('trigger')
    expect(triggers[triggers.length - 1])!.toHaveAttribute('data-expand', 'false')
    unmount()
  })

  it('should toggle panel when trigger is clicked and user is editor', async () => {
    const user = userEvent.setup()
    render(<AppInfo expand />)

    await user.click(screen.getByTestId('trigger'))

    expect(mockSetPanelOpen).toHaveBeenCalled()
    const updater = mockSetPanelOpen.mock.calls[0]![0] as (v: boolean) => boolean
    expect(updater(false)).toBe(true)
    expect(updater(true)).toBe(false)
  })

  it('should not toggle panel when trigger is clicked and user is not editor', async () => {
    const user = userEvent.setup()
    mockIsCurrentWorkspaceEditor = false
    render(<AppInfo expand />)

    await user.click(screen.getByTestId('trigger'))

    expect(mockSetPanelOpen).not.toHaveBeenCalled()
  })

  it('should show detail panel based on panelOpen when not onlyShowDetail', () => {
    mockUseAppInfoActions.panelOpen = true
    render(<AppInfo expand />)
    expect(screen.getByTestId('detail-panel'))!.toBeInTheDocument()
  })

  it('should show detail panel based on openState when onlyShowDetail', () => {
    render(<AppInfo expand onlyShowDetail openState />)
    expect(screen.getByTestId('detail-panel'))!.toBeInTheDocument()
  })

  it('should hide detail panel when openState is false and onlyShowDetail', () => {
    render(<AppInfo expand onlyShowDetail openState={false} />)
    expect(screen.queryByTestId('detail-panel')).not.toBeInTheDocument()
  })
})
