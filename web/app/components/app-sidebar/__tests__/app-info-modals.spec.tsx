import type { ActiveModal } from '../hooks/use-app-info-actions'
import type { App, AppSSO } from '@/types/app'
import { render, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import AppInfoModals from '../components/app-info-modals'

vi.mock('next/dynamic', () => ({
  default: (loader: () => Promise<{ default: React.ComponentType }>) => {
    let Resolved: React.ComponentType | null = null
    const promise = loader().then((mod) => {
      Resolved = (mod as { default: React.ComponentType }).default ?? mod
    })
    function DynamicWrapper(props: Record<string, unknown>) {
      if (!Resolved)
        throw promise
      return React.createElement(Resolved, props)
    }
    return function SuspenseWrapper(props: Record<string, unknown>) {
      return React.createElement(React.Suspense, { fallback: null }, React.createElement(DynamicWrapper, props))
    }
  },
}))

vi.mock('@/app/components/app/switch-app-modal', () => ({
  default: ({ show, onClose }: { show: boolean, onClose: () => void }) => (
    show ? <div data-testid="switch-modal" onClick={onClose}>Switch</div> : null
  ),
}))

vi.mock('@/app/components/explore/create-app-modal', () => ({
  default: ({ show, onHide, isEditModal }: { show: boolean, onHide: () => void, isEditModal?: boolean }) => (
    show ? <div data-testid="create-modal" data-edit={isEditModal} onClick={onHide}>Create</div> : null
  ),
}))

vi.mock('@/app/components/app/duplicate-modal', () => ({
  default: ({ show, onHide }: { show: boolean, onHide: () => void }) => (
    show ? <div data-testid="duplicate-modal" onClick={onHide}>Duplicate</div> : null
  ),
}))

vi.mock('@/app/components/workflow/update-dsl-modal', () => ({
  default: ({ onCancel, onBackup }: { onCancel: () => void, onBackup: () => void }) => (
    <div data-testid="import-dsl-modal" onClick={onCancel}>
      <button onClick={onBackup}>Backup</button>
    </div>
  ),
}))

vi.mock('@/app/components/workflow/dsl-export-confirm-modal', () => ({
  default: ({ envList, onClose, onConfirm }: { envList: unknown[], onClose: () => void, onConfirm: (v?: boolean) => void }) => (
    <div data-testid="dsl-export-modal" onClick={onClose}>
      <span>
        {envList.length}
        {' '}
        secrets
      </span>
      <button onClick={() => onConfirm(true)}>Include</button>
    </div>
  ),
}))

const mockAppDetail = {
  id: 'app-1',
  name: 'Test App',
  mode: 'advanced-chat',
  icon: '🤖',
  icon_type: 'emoji',
  icon_background: '#fff',
  icon_url: '',
  description: 'desc',
  use_icon_as_answer_icon: false,
  max_active_requests: null,
} as App & Partial<AppSSO>

const baseProps = {
  appDetail: mockAppDetail,
  activeModal: null as ActiveModal,
  showExportWarning: false,
  secretEnvList: [] as never[],
  onCloseModal: vi.fn(),
  onCloseExportWarning: vi.fn(),
  onEdit: vi.fn(),
  onCopy: vi.fn(),
  onExport: vi.fn(),
  onConfirmDelete: vi.fn(),
  onConfirmExport: vi.fn(),
  onExportCheck: vi.fn(),
  onClearSecretEnvList: vi.fn(),
}

describe('AppInfoModals', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render nothing when no modal is active', () => {
    const { container } = render(<AppInfoModals {...baseProps} />)
    expect(container.children.length).toBe(0)
  })

  it('should render SwitchAppModal', async () => {
    render(<AppInfoModals {...baseProps} activeModal="switch" />)
    await waitFor(() => expect(screen.getByTestId('switch-modal')).toBeInTheDocument())
  })

  it('should render CreateAppModal in edit mode', async () => {
    render(<AppInfoModals {...baseProps} activeModal="edit" />)
    await waitFor(() => {
      expect(screen.getByTestId('create-modal')).toBeInTheDocument()
      expect(screen.getByTestId('create-modal')).toHaveAttribute('data-edit', 'true')
    })
  })

  it('should render DuplicateAppModal', async () => {
    render(<AppInfoModals {...baseProps} activeModal="duplicate" />)
    await waitFor(() => expect(screen.getByTestId('duplicate-modal')).toBeInTheDocument())
  })

  it('should render delete Confirm dialog', async () => {
    render(<AppInfoModals {...baseProps} activeModal="confirmDelete" />)
    await waitFor(() => expect(screen.getByTestId('confirm-overlay')).toBeInTheDocument())
  })

  it('should render UpdateDSLModal', async () => {
    render(<AppInfoModals {...baseProps} activeModal="importDSL" />)
    await waitFor(() => expect(screen.getByTestId('import-dsl-modal')).toBeInTheDocument())
  })

  it('should render export warning when showExportWarning is true', async () => {
    render(<AppInfoModals {...baseProps} showExportWarning={true} />)
    await waitFor(() => expect(screen.getByTestId('confirm-overlay')).toBeInTheDocument())
  })

  it('should render DSLExportConfirmModal when secretEnvList is non-empty', async () => {
    const envList = [{ id: 'e1', key: 'K', value: '***', value_type: 'secret' }] as never[]
    render(<AppInfoModals {...baseProps} secretEnvList={envList} />)
    await waitFor(() => expect(screen.getByTestId('dsl-export-modal')).toBeInTheDocument())
  })

  it('should not render DSLExportConfirmModal when secretEnvList is empty', () => {
    render(<AppInfoModals {...baseProps} />)
    expect(screen.queryByTestId('dsl-export-modal')).not.toBeInTheDocument()
  })

  it('should show export warning independently of importDSL modal', async () => {
    render(<AppInfoModals {...baseProps} activeModal="importDSL" showExportWarning={true} />)
    await waitFor(() => {
      expect(screen.getByTestId('import-dsl-modal')).toBeInTheDocument()
      expect(screen.getByTestId('confirm-overlay')).toBeInTheDocument()
    })
  })
})
