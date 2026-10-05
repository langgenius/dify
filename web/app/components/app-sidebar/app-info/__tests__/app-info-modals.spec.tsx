import type { AppDetailWithSite } from '@dify/contracts/api/console/apps/types.gen'
import type { DynamicOptions, Loader } from 'next/dynamic'
import type { ComponentProps } from 'react'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { createAppDetailFixture } from '@/test/fixtures/app'
import { AppModeEnum } from '@/types/app'
import AppInfoModals from '../app-info-modals'

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}))

const { loadDynamic, observeImportOpen } = vi.hoisted(() => ({
  loadDynamic: vi.fn(),
  observeImportOpen: vi.fn(),
}))

vi.mock('next/dynamic', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/dynamic')>()
  return {
    ...actual,
    default: <Props,>(
      loader: DynamicOptions<Props> | Loader<Props>,
      options?: DynamicOptions<Props>,
    ) => {
      if (typeof loader !== 'function') return actual.default(loader, options)
      return actual.default(() => {
        loadDynamic()
        return loader()
      }, options)
    },
  }
})

vi.mock('@/app/components/explore/create-app-modal', () => ({
  default: ({
    show,
    onHide,
    isEditModal,
  }: {
    show: boolean
    onHide: () => void
    isEditModal?: boolean
  }) =>
    show ? (
      <div data-testid={isEditModal ? 'edit-modal' : 'create-modal'}>
        <button type="button" onClick={onHide}>
          Close Edit
        </button>
      </div>
    ) : null,
}))

vi.mock('@/app/components/workflow/update-dsl-modal', () => ({
  UpdateDSLDialog: ({
    open,
    onOpenChange,
    onBackup,
  }: {
    open: boolean
    onOpenChange: (open: boolean) => void
    onBackup: () => void
  }) => {
    observeImportOpen(open)
    return open ? (
      <div data-testid="import-dsl-modal">
        <button type="button" onClick={() => onOpenChange(false)}>
          Cancel Import
        </button>
        <button type="button" onClick={onBackup}>
          Backup
        </button>
      </div>
    ) : null
  },
}))

vi.mock('@/app/components/app/export-confirm-modal', () => ({
  AppExportConfirmContent: ({
    onConfirm,
    onClose,
  }: {
    onConfirm: (include?: boolean) => void
    onClose: () => void
  }) => (
    <div data-testid="dsl-export-confirm-modal">
      <button type="button" onClick={() => onConfirm(true)}>
        Export Include
      </button>
      <button type="button" onClick={onClose}>
        Close Export
      </button>
    </div>
  ),
  default: ({
    onConfirm,
    onClose,
  }: {
    onConfirm: (include?: boolean) => void
    onClose: () => void
  }) => (
    <div data-testid="dsl-export-confirm-modal">
      <button type="button" onClick={() => onConfirm(true)}>
        Export Include
      </button>
      <button type="button" onClick={onClose}>
        Close Export
      </button>
    </div>
  ),
}))

const createAppDetail = (overrides: Partial<AppDetailWithSite> = {}) =>
  createAppDetailFixture({
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
  })

const defaultProps = {
  appDetail: createAppDetail(),
  closeModal: vi.fn(),
  secretEnvList: [] as never[],
  setSecretEnvList: vi.fn(),
  onEdit: vi.fn(),
  onCopy: vi.fn(async () => {}),
  onExport: vi.fn(async () => true),
  isExporting: false,
  exportCheck: vi.fn(),
  handleConfirmExport: vi.fn(async () => {}),
  onConfirmDelete: vi.fn(),
}

describe('AppInfoModals', () => {
  beforeAll(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('loads the import module only on first activation and retains its closed owner', async () => {
    const { rerender } = render(<AppInfoModals {...defaultProps} activeModal={null} />)
    expect(loadDynamic).not.toHaveBeenCalled()
    expect(observeImportOpen).not.toHaveBeenCalled()

    rerender(<AppInfoModals {...defaultProps} activeModal="importDSL" />)
    expect(await screen.findByTestId('import-dsl-modal')).toBeInTheDocument()
    expect(loadDynamic).toHaveBeenCalledTimes(1)

    rerender(<AppInfoModals {...defaultProps} activeModal={null} />)
    expect(observeImportOpen).toHaveBeenLastCalledWith(false)
    expect(screen.queryByTestId('import-dsl-modal')).not.toBeInTheDocument()

    rerender(<AppInfoModals {...defaultProps} activeModal="importDSL" />)
    expect(await screen.findByTestId('import-dsl-modal')).toBeInTheDocument()
    expect(loadDynamic).toHaveBeenCalledTimes(1)
  })

  it('should render nothing when activeModal is null', async () => {
    await act(async () => {
      render(<AppInfoModals {...defaultProps} activeModal={null} />)
    })
    expect(screen.queryByRole('dialog', { name: 'app.switch' })).not.toBeInTheDocument()
    expect(screen.queryByText('app.deleteAppConfirmTitle')).not.toBeInTheDocument()
  })

  it('loads the switch module only when its command is first activated', async () => {
    const { rerender } = render(<AppInfoModals {...defaultProps} activeModal={null} />)
    expect(loadDynamic).not.toHaveBeenCalled()

    rerender(<AppInfoModals {...defaultProps} activeModal="switch" />)
    expect(await screen.findByRole('dialog', { name: 'app.switch' })).toBeInTheDocument()
    expect(loadDynamic).toHaveBeenCalledTimes(1)

    rerender(<AppInfoModals {...defaultProps} activeModal={null} />)
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'app.switch' })).not.toBeInTheDocument(),
    )
    rerender(<AppInfoModals {...defaultProps} activeModal="switch" />)
    expect(await screen.findByRole('dialog', { name: 'app.switch' })).toBeInTheDocument()
    expect(loadDynamic).toHaveBeenCalledTimes(1)
  })

  it('should render CreateAppModal in edit mode when activeModal is edit', async () => {
    await act(async () => {
      render(<AppInfoModals {...defaultProps} activeModal="edit" />)
    })
    await waitFor(() => {
      expect(screen.getByTestId('edit-modal')).toBeInTheDocument()
    })
  })

  it('loads the duplicate module on first activation and creates a fresh draft after closing', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<AppInfoModals {...defaultProps} activeModal={null} />)
    expect(loadDynamic).not.toHaveBeenCalled()

    rerender(<AppInfoModals {...defaultProps} activeModal="duplicate" />)
    const dialog = await screen.findByRole('dialog', { name: 'app.duplicateTitle' })
    expect(loadDynamic).toHaveBeenCalledTimes(1)
    const input = within(dialog).getByRole('textbox', { name: 'explore.appCustomize.subTitle' })
    await user.clear(input)
    await user.type(input, 'Unsubmitted copy')
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.cancel' }))
    expect(defaultProps.closeModal).toHaveBeenCalledTimes(1)

    rerender(<AppInfoModals {...defaultProps} activeModal={null} />)
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'app.duplicateTitle' })).not.toBeInTheDocument(),
    )
    rerender(<AppInfoModals {...defaultProps} activeModal="duplicate" />)
    const reopened = await screen.findByRole('dialog', { name: 'app.duplicateTitle' })
    expect(
      within(reopened).getByRole('textbox', { name: 'explore.appCustomize.subTitle' }),
    ).not.toHaveValue('Unsubmitted copy')
    expect(loadDynamic).toHaveBeenCalledTimes(1)
  })

  it('awaits the copy callback, retains a failed draft, and leaves successful closing to the owner', async () => {
    const user = userEvent.setup()
    let rejectCopy!: (reason: Error) => void
    const onCopy = vi
      .fn<ComponentProps<typeof AppInfoModals>['onCopy']>()
      .mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            rejectCopy = reject
          }),
      )
      .mockResolvedValue(undefined)
    render(<AppInfoModals {...defaultProps} onCopy={onCopy} activeModal="duplicate" />)
    const dialog = await screen.findByRole('dialog', { name: 'app.duplicateTitle' })
    const input = within(dialog).getByRole('textbox', { name: 'explore.appCustomize.subTitle' })
    await user.clear(input)
    await user.type(input, 'Retry copy{Enter}')
    await waitFor(() => expect(onCopy).toHaveBeenCalledTimes(1))
    expect(input).toHaveAttribute('readonly')
    await user.keyboard('{Enter}{Escape}')
    expect(onCopy).toHaveBeenCalledTimes(1)
    expect(defaultProps.closeModal).not.toHaveBeenCalled()
    expect(within(dialog).getByRole('button', { name: 'common.operation.cancel' })).toBeDisabled()

    await act(async () => rejectCopy(new Error('Copy failed')))
    await waitFor(() => expect(input).not.toHaveAttribute('readonly'))
    expect(input).toHaveValue('Retry copy')
    expect(dialog).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'app.duplicate' }))
    await waitFor(() => expect(onCopy).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(input).not.toHaveAttribute('readonly'))
    expect(onCopy).toHaveBeenLastCalledWith({
      name: 'Retry copy',
      icon_type: 'emoji',
      icon: '🤖',
      icon_background: '#FFEAD5',
    })
    expect(defaultProps.closeModal).not.toHaveBeenCalled()
    expect(dialog).toBeInTheDocument()
  })

  it('should render delete alert dialog when activeModal is delete', async () => {
    await act(async () => {
      render(<AppInfoModals {...defaultProps} activeModal="delete" />)
    })
    await waitFor(() => {
      expect(screen.getByText('app.deleteAppConfirmTitle')).toBeInTheDocument()
      expect(screen.getByRole('textbox')).toBeInTheDocument()
    })
  })

  it('should name the delete confirmation input with its visible label', async () => {
    await act(async () => {
      render(<AppInfoModals {...defaultProps} activeModal="delete" />)
    })

    expect(
      await screen.findByRole('textbox', { name: /app\.deleteAppConfirmInputLabel/ }),
    ).toBeInTheDocument()
  })

  it('should render UpdateDSLModal when activeModal is importDSL', async () => {
    await act(async () => {
      render(<AppInfoModals {...defaultProps} activeModal="importDSL" />)
    })
    await waitFor(() => {
      expect(screen.getByTestId('import-dsl-modal')).toBeInTheDocument()
    })
  })

  it('should render export warning alert dialog when activeModal is exportWarning', async () => {
    await act(async () => {
      render(<AppInfoModals {...defaultProps} activeModal="exportWarning" />)
    })
    await waitFor(() => {
      expect(screen.getByText('workflow.sidebar.exportWarning')).toBeInTheDocument()
    })
  })

  it('should render AppExportConfirmModal when secretEnvList is not empty', async () => {
    await act(async () => {
      render(
        <AppInfoModals
          {...defaultProps}
          activeModal={null}
          secretEnvList={[
            {
              id: 'env-1',
              key: 'SECRET',
              value: '',
              value_type: 'secret',
              name: 'Secret',
            } as never,
          ]}
        />,
      )
    })
    await waitFor(() => {
      expect(screen.getByTestId('dsl-export-confirm-modal')).toBeInTheDocument()
    })
  })

  it('should not render AppExportConfirmModal when secretEnvList is empty', async () => {
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

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'common.operation.cancel' })).toBeInTheDocument(),
    )
    await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))

    expect(defaultProps.closeModal).toHaveBeenCalledTimes(1)
  })

  it('should clear the delete confirmation input when delete modal is cancelled', async () => {
    const user = userEvent.setup()
    await act(async () => {
      render(<AppInfoModals {...defaultProps} activeModal="delete" />)
    })

    const input = await screen.findByRole('textbox')
    await user.type(input, 'wrong-name')
    await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))

    expect(defaultProps.closeModal).toHaveBeenCalledTimes(1)
    expect(input).toHaveValue('')
  })

  it('should not confirm delete when the form is submitted with unmatched input', async () => {
    await act(async () => {
      render(<AppInfoModals {...defaultProps} activeModal="delete" />)
    })

    const form = document.querySelector('form')
    expect(form).toBeTruthy()

    fireEvent.submit(form!)

    expect(defaultProps.onConfirmDelete).not.toHaveBeenCalled()
  })

  it('should call onConfirmDelete when confirm on delete modal', async () => {
    const user = userEvent.setup()
    await act(async () => {
      render(<AppInfoModals {...defaultProps} activeModal="delete" />)
    })

    await user.type(screen.getByRole('textbox'), 'Test App')
    await user.click(screen.getByRole('button', { name: 'common.operation.confirm' }))

    expect(defaultProps.onConfirmDelete).toHaveBeenCalledTimes(1)
  })

  it('should call handleConfirmExport when confirm on export warning', async () => {
    const user = userEvent.setup()
    await act(async () => {
      render(<AppInfoModals {...defaultProps} activeModal="exportWarning" />)
    })

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'common.operation.confirm' })).toBeInTheDocument(),
    )
    await user.click(screen.getByRole('button', { name: 'common.operation.confirm' }))

    expect(defaultProps.handleConfirmExport).toHaveBeenCalledTimes(1)
  })

  it('should show the export warning confirmation as pending during export', async () => {
    await act(async () => {
      render(<AppInfoModals {...defaultProps} activeModal="exportWarning" isExporting />)
    })

    expect(
      await screen.findByRole('button', { name: 'common.operation.exporting' }),
    ).toBeInTheDocument()
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

  it('should call setSecretEnvList with empty array when closing AppExportConfirmModal', async () => {
    const user = userEvent.setup()
    await act(async () => {
      render(
        <AppInfoModals
          {...defaultProps}
          activeModal={null}
          secretEnvList={[
            {
              id: 'env-1',
              key: 'SECRET',
              value: '',
              value_type: 'secret',
              name: 'Secret',
            } as never,
          ]}
        />,
      )
    })

    await waitFor(() => expect(screen.getByText('Close Export')).toBeInTheDocument())
    await user.click(screen.getByText('Close Export'))

    expect(defaultProps.setSecretEnvList).toHaveBeenCalledWith([])
  })
})
