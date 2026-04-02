import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import CreateBlankSkillModal from '.././create-blank-skill-modal'

const mocks = vi.hoisted(() => ({
  appId: 'app-1',
  startUpload: vi.fn(),
  failUpload: vi.fn(),
  uploadTree: vi.fn(),
  openCreatedSkillDocument: vi.fn(),
  prepareSkillUploadFile: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  existingNames: new Set<string>(),
}))

vi.mock('../../hooks/file-tree/data/use-skill-asset-tree', () => ({
  useExistingSkillNames: () => ({
    data: mocks.existingNames,
  }),
}))

vi.mock('../../utils/skill-upload-utils', () => ({
  prepareSkillUploadFile: (...args: unknown[]) => mocks.prepareSkillUploadFile(...args),
}))

vi.mock('.././use-skill-batch-upload', () => ({
  useSkillBatchUpload: () => ({
    appId: mocks.appId,
    startUpload: mocks.startUpload,
    failUpload: mocks.failUpload,
    uploadTree: mocks.uploadTree,
    openCreatedSkillDocument: mocks.openCreatedSkillDocument,
  }),
}))

vi.mock('@/app/components/base/ui/toast', () => ({
  toast: {
    success: (...args: unknown[]) => mocks.toastSuccess(...args),
    error: (...args: unknown[]) => mocks.toastError(...args),
  },
}))

describe('CreateBlankSkillModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.existingNames = new Set()
    mocks.appId = 'app-1'
    mocks.prepareSkillUploadFile.mockImplementation(async (file: File) => file)
    mocks.uploadTree.mockResolvedValue([])
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
      mocks.uploadTree.mockResolvedValueOnce([
        { id: 'skill-folder-id', name: 'new-skill', node_type: 'folder', size: 0, children: [] },
      ])
      render(<CreateBlankSkillModal isOpen onClose={onClose} />)

      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'new-skill' } })
      fireEvent.click(screen.getByRole('button', { name: /common\.operation\.create/i }))

      await waitFor(() => {
        expect(mocks.uploadTree).toHaveBeenCalledTimes(1)
      })

      expect(mocks.startUpload).toHaveBeenCalledWith(1)
      expect(mocks.openCreatedSkillDocument).toHaveBeenCalledWith([
        { id: 'skill-folder-id', name: 'new-skill', node_type: 'folder', size: 0, children: [] },
      ])
      expect(mocks.toastSuccess).toHaveBeenCalledWith('workflow.skill.startTab.createSuccess:{"name":"new-skill"}')
      expect(mocks.toastError).not.toHaveBeenCalled()
      expect(onClose).toHaveBeenCalledTimes(1)
      expect(screen.getByRole('textbox')).toHaveValue('')
    })

    it('should set partial error and show error toast when upload fails', async () => {
      const onClose = vi.fn()
      mocks.uploadTree.mockRejectedValueOnce(new Error('upload failed'))
      render(<CreateBlankSkillModal isOpen onClose={onClose} />)

      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'new-skill' } })
      fireEvent.click(screen.getByRole('button', { name: /common\.operation\.create/i }))

      await waitFor(() => {
        expect(mocks.failUpload).toHaveBeenCalledTimes(1)
      })

      expect(mocks.toastError).toHaveBeenCalledWith('workflow.skill.startTab.createError')
      expect(mocks.toastSuccess).not.toHaveBeenCalled()
      expect(onClose).not.toHaveBeenCalled()
      expect(screen.getByRole('textbox')).toHaveValue('')
    })

    it('should not start upload when app id is missing', () => {
      mocks.appId = ''
      render(<CreateBlankSkillModal isOpen onClose={vi.fn()} />)

      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'new-skill' } })
      fireEvent.click(screen.getByRole('button', { name: /common\.operation\.create/i }))

      expect(mocks.uploadTree).not.toHaveBeenCalled()
      expect(mocks.startUpload).not.toHaveBeenCalled()
    })

    it('should trigger create flow when Enter key is pressed and form is valid', async () => {
      render(<CreateBlankSkillModal isOpen onClose={vi.fn()} />)

      const input = screen.getByRole('textbox')
      fireEvent.change(input, { target: { value: 'new-skill' } })
      fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' })

      await waitFor(() => {
        expect(mocks.uploadTree).toHaveBeenCalledTimes(1)
      })
    })

    it('should trim the skill name before creating the upload payload', async () => {
      render(<CreateBlankSkillModal isOpen onClose={vi.fn()} />)

      fireEvent.change(screen.getByRole('textbox'), { target: { value: '  new-skill  ' } })
      fireEvent.click(screen.getByRole('button', { name: /common\.operation\.create/i }))

      await waitFor(() => {
        expect(mocks.prepareSkillUploadFile).toHaveBeenCalledTimes(1)
      })

      expect(mocks.uploadTree).toHaveBeenCalledWith(expect.objectContaining({
        tree: [
          expect.objectContaining({
            name: 'new-skill',
            children: [expect.objectContaining({ name: 'SKILL.md' })],
          }),
        ],
        files: expect.any(Map),
      }))
      const uploadFiles = mocks.uploadTree.mock.calls[0][0].files as Map<string, File>
      expect([...uploadFiles.keys()]).toEqual(['new-skill/SKILL.md'])
    })

    it('should keep the modal locked while a skill is being created', async () => {
      const onClose = vi.fn()
      mocks.uploadTree.mockImplementationOnce(() => new Promise(() => {}))

      render(<CreateBlankSkillModal isOpen onClose={onClose} />)

      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'new-skill' } })
      fireEvent.click(screen.getByRole('button', { name: /common\.operation\.create/i }))

      expect(screen.queryByRole('button', { name: /close/i })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: /common\.operation\.cancel/i })).toBeDisabled()

      fireEvent.click(screen.getByRole('button', { name: /common\.operation\.cancel/i }))
      expect(onClose).not.toHaveBeenCalled()
    })
  })
})
