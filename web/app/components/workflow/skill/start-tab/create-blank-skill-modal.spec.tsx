import type { App, AppSSO } from '@/types/app'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useStore as useAppStore } from '@/app/components/app/store'
import CreateBlankSkillModal from './create-blank-skill-modal'

type MockWorkflowState = {
  setUploadStatus: ReturnType<typeof vi.fn>
  setUploadProgress: ReturnType<typeof vi.fn>
  openTab: ReturnType<typeof vi.fn>
}

const mocks = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  emitTreeUpdate: vi.fn(),
  prepareSkillUploadFile: vi.fn(),
  toastNotify: vi.fn(),
  existingNames: new Set<string>(),
  workflowState: {
    setUploadStatus: vi.fn(),
    setUploadProgress: vi.fn(),
    openTab: vi.fn(),
  } as MockWorkflowState,
}))

vi.mock('@/service/use-app-asset', () => ({
  useBatchUpload: () => ({
    mutateAsync: mocks.mutateAsync,
  }),
}))

vi.mock('../hooks/file-tree/data/use-skill-asset-tree', () => ({
  useExistingSkillNames: () => ({
    data: mocks.existingNames,
  }),
}))

vi.mock('../hooks/file-tree/data/use-skill-tree-collaboration', () => ({
  useSkillTreeUpdateEmitter: () => mocks.emitTreeUpdate,
}))

vi.mock('../utils/skill-upload-utils', () => ({
  prepareSkillUploadFile: (...args: unknown[]) => mocks.prepareSkillUploadFile(...args),
}))

vi.mock('@/app/components/workflow/store', () => ({
  useWorkflowStore: () => ({
    getState: () => mocks.workflowState,
  }),
}))

vi.mock('@/app/components/base/toast', () => ({
  default: {
    notify: (...args: unknown[]) => mocks.toastNotify(...args),
  },
}))

describe('CreateBlankSkillModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.existingNames = new Set()
    useAppStore.setState({
      appDetail: { id: 'app-1' } as App & Partial<AppSSO>,
    })
    mocks.prepareSkillUploadFile.mockImplementation(async (file: File) => file)
  })

  describe('Rendering', () => {
    it('should render modal title and disable create button when skill name is empty', () => {
      render(<CreateBlankSkillModal isOpen onClose={vi.fn()} />)

      expect(screen.getByText('workflow.skill.startTab.createModal.title')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /common\.operation\.create/i })).toBeDisabled()
    })

    it('should clear input and call onClose when cancel button is clicked', () => {
      const onClose = vi.fn()
      render(<CreateBlankSkillModal isOpen onClose={onClose} />)

      const input = screen.getByRole('textbox')
      fireEvent.change(input, { target: { value: 'to-be-cleared' } })
      fireEvent.click(screen.getByRole('button', { name: /common\.operation\.cancel/i }))

      expect(onClose).toHaveBeenCalledTimes(1)
      expect(input).toHaveValue('')
    })
  })

  describe('Validation', () => {
    it('should show duplicate error and disable create when skill name already exists', () => {
      mocks.existingNames = new Set(['existing-skill'])
      render(<CreateBlankSkillModal isOpen onClose={vi.fn()} />)

      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'existing-skill' } })

      expect(screen.getByText('workflow.skill.startTab.createModal.nameDuplicate')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /common\.operation\.create/i })).toBeDisabled()
    })
  })

  describe('Create Flow', () => {
    it('should upload skill template and notify success when creation succeeds', async () => {
      const onClose = vi.fn()
      mocks.mutateAsync.mockImplementationOnce(async ({ onProgress }: { onProgress?: (uploaded: number, total: number) => void }) => {
        onProgress?.(1, 1)
        return [{
          children: [{ id: 'skill-md-id' }],
        }]
      })
      render(<CreateBlankSkillModal isOpen onClose={onClose} />)

      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'new-skill' } })
      fireEvent.click(screen.getByRole('button', { name: /common\.operation\.create/i }))

      await waitFor(() => {
        expect(mocks.mutateAsync).toHaveBeenCalledTimes(1)
      })

      expect(mocks.workflowState.setUploadStatus).toHaveBeenNthCalledWith(1, 'uploading')
      expect(mocks.workflowState.setUploadStatus).toHaveBeenNthCalledWith(2, 'success')
      expect(mocks.workflowState.setUploadProgress).toHaveBeenCalledWith({ uploaded: 0, total: 1, failed: 0 })
      expect(mocks.workflowState.setUploadProgress).toHaveBeenCalledWith({ uploaded: 1, total: 1, failed: 0 })
      expect(mocks.emitTreeUpdate).toHaveBeenCalledTimes(1)
      expect(mocks.workflowState.openTab).toHaveBeenCalledWith('skill-md-id', { pinned: true })
      expect(mocks.toastNotify).toHaveBeenCalledWith({
        type: 'success',
        message: 'workflow.skill.startTab.createSuccess:{"name":"new-skill"}',
      })
      expect(onClose).toHaveBeenCalledTimes(1)
      expect(screen.getByRole('textbox')).toHaveValue('')
    })

    it('should set partial error and show error toast when upload fails', async () => {
      const onClose = vi.fn()
      mocks.mutateAsync.mockRejectedValueOnce(new Error('upload failed'))
      render(<CreateBlankSkillModal isOpen onClose={onClose} />)

      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'new-skill' } })
      fireEvent.click(screen.getByRole('button', { name: /common\.operation\.create/i }))

      await waitFor(() => {
        expect(mocks.workflowState.setUploadStatus).toHaveBeenCalledWith('partial_error')
      })

      expect(mocks.toastNotify).toHaveBeenCalledWith({
        type: 'error',
        message: 'workflow.skill.startTab.createError',
      })
      expect(onClose).not.toHaveBeenCalled()
      expect(screen.getByRole('textbox')).toHaveValue('')
    })

    it('should not start upload when app id is missing', () => {
      useAppStore.setState({ appDetail: undefined })
      render(<CreateBlankSkillModal isOpen onClose={vi.fn()} />)

      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'new-skill' } })
      fireEvent.click(screen.getByRole('button', { name: /common\.operation\.create/i }))

      expect(mocks.mutateAsync).not.toHaveBeenCalled()
    })

    it('should trigger create flow when Enter key is pressed and form is valid', async () => {
      mocks.mutateAsync.mockResolvedValueOnce([])
      render(<CreateBlankSkillModal isOpen onClose={vi.fn()} />)

      const input = screen.getByRole('textbox')
      fireEvent.change(input, { target: { value: 'new-skill' } })
      fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' })

      await waitFor(() => {
        expect(mocks.mutateAsync).toHaveBeenCalledTimes(1)
      })
    })
  })
})
