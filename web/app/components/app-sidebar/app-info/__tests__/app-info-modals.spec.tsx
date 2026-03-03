import type { App, AppSSO } from '@/types/app'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { AppModeEnum } from '@/types/app'
import AppInfoModals from '../app-info-modals'

vi.mock('next/dynamic', () => ({
  default: (loader: () => Promise<{ default: React.ComponentType }>) => {
    const LazyComp = React.lazy(loader)
    return function DynamicWrapper(props: Record<string, unknown>) {
      return React.createElement(
        React.Suspense,
        { fallback: null },
        React.createElement(LazyComp, props),
      )
    }
  },
}))

vi.mock('@/app/components/app/switch-app-modal', () => ({
  default: ({ show, onClose }: { show: boolean, onClose: () => void }) => (
    show ? <div data-testid="switch-modal"><button type="button" onClick={onClose}>Close Switch</button></div> : null
  ),
}))

vi.mock('@/app/components/explore/create-app-modal', () => ({
  default: ({ show, onHide, isEditModal }: { show: boolean, onHide: () => void, isEditModal?: boolean }) => (
    show ? <div data-testid={isEditModal ? 'edit-modal' : 'create-modal'}><button type="button" onClick={onHide}>Close Edit</button></div> : null
  ),
}))

vi.mock('@/app/components/app/duplicate-modal', () => ({
  default: ({ show, onHide }: { show: boolean, onHide: () => void }) => (
    show ? <div data-testid="duplicate-modal"><button type="button" onClick={onHide}>Close Dup</button></div> : null
  ),
}))

vi.mock('@/app/components/base/confirm', () => ({
  default: ({ isShow, title, onConfirm, onCancel }: {
    isShow: boolean
    title: string
    onConfirm: () => void
    onCancel: () => void
  }) => (
    isShow
      ? (
          <div data-testid="confirm-modal" data-title={title}>
            <button type="button" onClick={onConfirm}>Confirm</button>
            <button type="button" onClick={onCancel}>Cancel</button>
          </div>
        )
      : null
  ),
}))

vi.mock('@/app/components/workflow/update-dsl-modal', () => ({
  default: ({ onCancel, onBackup }: { onCancel: () => void, onBackup: () => void }) => (
    <div data-testid="import-dsl-modal">
      <button type="button" onClick={onCancel}>Cancel Import</button>
      <button type="button" onClick={onBackup}>Backup</button>
    </div>
  ),
}))

vi.mock('@/app/components/workflow/dsl-export-confirm-modal', () => ({
  default: ({ onConfirm, onClose }: { onConfirm: (include?: boolean) => void, onClose: () => void }) => (
    <div data-testid="dsl-export-confirm-modal">
      <button type="button" onClick={() => onConfirm(true)}>Export Include</button>
      <button type="button" onClick={onClose}>Close Export</button>
    </div>
  ),
}))

const createAppDetail = (overrides: Partial<App> = {}): App & Partial<AppSSO> => ({
  id: 'app-1',
  name: 'Test App',
  mode: AppModeEnum.CHAT,
  icon: '🤖',
  icon_type: 'emoji',
  icon_background: '#FFEAD5',
  icon_url: '',
  description: '',
  use_icon_as_answer_icon: false,
  max_active_requests: null,
  ...overrides,
} as App & Partial<AppSSO>)

const defaultProps = {
  appDetail: createAppDetail(),
  closeModal: vi.fn(),
  secretEnvList: [] as never[],
  setSecretEnvList: vi.fn(),
  onEdit: vi.fn(),
  onCopy: vi.fn(),
  onExport: vi.fn(),
  exportCheck: vi.fn(),
  handleConfirmExport: vi.fn(),
  onConfirmDelete: vi.fn(),
}

describe('AppInfoModals', () => {
  beforeAll(async () => {
    await new Promise(resolve => setTimeout(resolve, 0))
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render nothing when activeModal is null', async () => {
    await act(async () => {
      render(<AppInfoModals {...defaultProps} activeModal={null} />)
    })
    expect(screen.queryByTestId('switch-modal')).not.toBeInTheDocument()
    expect(screen.queryByTestId('confirm-modal')).not.toBeInTheDocument()
  })

  it('should render SwitchAppModal when activeModal is switch', async () => {
    await act(async () => {
      render(<AppInfoModals {...defaultProps} activeModal="switch" />)
    })
    await waitFor(() => {
      expect(screen.getByTestId('switch-modal')).toBeInTheDocument()
    })
  })

  it('should render CreateAppModal in edit mode when activeModal is edit', async () => {
    await act(async () => {
      render(<AppInfoModals {...defaultProps} activeModal="edit" />)
    })
    await waitFor(() => {
      expect(screen.getByTestId('edit-modal')).toBeInTheDocument()
    })
  })

  it('should render DuplicateAppModal when activeModal is duplicate', async () => {
    await act(async () => {
      render(<AppInfoModals {...defaultProps} activeModal="duplicate" />)
    })
    await waitFor(() => {
      expect(screen.getByTestId('duplicate-modal')).toBeInTheDocument()
    })
  })

  it('should render Confirm for delete when activeModal is delete', async () => {
    await act(async () => {
      render(<AppInfoModals {...defaultProps} activeModal="delete" />)
    })
    await waitFor(() => {
      const confirm = screen.getByTestId('confirm-modal')
      expect(confirm).toBeInTheDocument()
      expect(confirm).toHaveAttribute('data-title', 'app.deleteAppConfirmTitle')
    })
  })

  it('should render UpdateDSLModal when activeModal is importDSL', async () => {
    await act(async () => {
      render(<AppInfoModals {...defaultProps} activeModal="importDSL" />)
    })
    await waitFor(() => {
      expect(screen.getByTestId('import-dsl-modal')).toBeInTheDocument()
    })
  })

  it('should render export warning Confirm when activeModal is exportWarning', async () => {
    await act(async () => {
      render(<AppInfoModals {...defaultProps} activeModal="exportWarning" />)
    })
    await waitFor(() => {
      const confirm = screen.getByTestId('confirm-modal')
      expect(confirm).toBeInTheDocument()
      expect(confirm).toHaveAttribute('data-title', 'workflow.sidebar.exportWarning')
    })
  })

  it('should render DSLExportConfirmModal when secretEnvList is not empty', async () => {
    await act(async () => {
      render(
        <AppInfoModals
          {...defaultProps}
          activeModal={null}
          secretEnvList={[{ id: 'env-1', key: 'SECRET', value: '', value_type: 'secret', name: 'Secret' } as never]}
        />,
      )
    })
    await waitFor(() => {
      expect(screen.getByTestId('dsl-export-confirm-modal')).toBeInTheDocument()
    })
  })

  it('should not render DSLExportConfirmModal when secretEnvList is empty', async () => {
    await act(async () => {
      render(<AppInfoModals {...defaultProps} activeModal={null} />)
    })
    expect(screen.queryByTestId('dsl-export-confirm-modal')).not.toBeInTheDocument()
  })

  it('should call closeModal when cancel on delete modal', async () => {
    const user = userEvent.setup()
    await act(async () => {
      render(<AppInfoModals {...defaultProps} activeModal="delete" />)
    })

    await waitFor(() => expect(screen.getByText('Cancel')).toBeInTheDocument())
    await user.click(screen.getByText('Cancel'))

    expect(defaultProps.closeModal).toHaveBeenCalledTimes(1)
  })

  it('should call onConfirmDelete when confirm on delete modal', async () => {
    const user = userEvent.setup()
    await act(async () => {
      render(<AppInfoModals {...defaultProps} activeModal="delete" />)
    })

    await waitFor(() => expect(screen.getByText('Confirm')).toBeInTheDocument())
    await user.click(screen.getByText('Confirm'))

    expect(defaultProps.onConfirmDelete).toHaveBeenCalledTimes(1)
  })

  it('should call handleConfirmExport when confirm on export warning', async () => {
    const user = userEvent.setup()
    await act(async () => {
      render(<AppInfoModals {...defaultProps} activeModal="exportWarning" />)
    })

    await waitFor(() => expect(screen.getByText('Confirm')).toBeInTheDocument())
    await user.click(screen.getByText('Confirm'))

    expect(defaultProps.handleConfirmExport).toHaveBeenCalledTimes(1)
  })

  it('should call exportCheck when backup on importDSL modal', async () => {
    const user = userEvent.setup()
    await act(async () => {
      render(<AppInfoModals {...defaultProps} activeModal="importDSL" />)
    })

    await waitFor(() => expect(screen.getByText('Backup')).toBeInTheDocument())
    await user.click(screen.getByText('Backup'))

    expect(defaultProps.exportCheck).toHaveBeenCalledTimes(1)
  })

  it('should call setSecretEnvList with empty array when closing DSLExportConfirmModal', async () => {
    const user = userEvent.setup()
    await act(async () => {
      render(
        <AppInfoModals
          {...defaultProps}
          activeModal={null}
          secretEnvList={[{ id: 'env-1', key: 'SECRET', value: '', value_type: 'secret', name: 'Secret' } as never]}
        />,
      )
    })

    await waitFor(() => expect(screen.getByText('Close Export')).toBeInTheDocument())
    await user.click(screen.getByText('Close Export'))

    expect(defaultProps.setSecretEnvList).toHaveBeenCalledWith([])
  })
})
