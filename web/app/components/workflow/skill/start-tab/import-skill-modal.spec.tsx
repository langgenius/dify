import type { App, AppSSO } from '@/types/app'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useStore as useAppStore } from '@/app/components/app/store'
import { ZipValidationError } from '../utils/zip-extract'
import ImportSkillModal from './import-skill-modal'

type MockWorkflowState = {
  setUploadStatus: ReturnType<typeof vi.fn>
  setUploadProgress: ReturnType<typeof vi.fn>
  openTab: ReturnType<typeof vi.fn>
}

const mocks = vi.hoisted(() => ({
  extractAndValidateZip: vi.fn(),
  buildUploadDataFromZip: vi.fn(),
  mutateAsync: vi.fn(),
  emitTreeUpdate: vi.fn(),
  toastNotify: vi.fn(),
  existingNames: new Set<string>(),
  workflowState: {
    setUploadStatus: vi.fn(),
    setUploadProgress: vi.fn(),
    openTab: vi.fn(),
  } as MockWorkflowState,
}))

vi.mock('../utils/zip-extract', () => {
  class MockZipValidationError extends Error {
    code: string

    constructor(code: string, message: string) {
      super(message)
      this.name = 'ZipValidationError'
      this.code = code
    }
  }

  return {
    ZipValidationError: MockZipValidationError,
    extractAndValidateZip: (...args: unknown[]) => mocks.extractAndValidateZip(...args),
  }
})

vi.mock('../utils/zip-to-upload-tree', () => ({
  buildUploadDataFromZip: (...args: unknown[]) => mocks.buildUploadDataFromZip(...args),
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

const createZipFile = (name = 'new-skill.zip', size = 1536) => {
  const binary = new Uint8Array(size)
  const file = new File([binary], name, { type: 'application/zip' })
  Object.defineProperty(file, 'arrayBuffer', {
    value: vi.fn().mockResolvedValue(binary.buffer),
    configurable: true,
  })
  return file
}

const selectFile = (file: File) => {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement | null
  if (!input)
    throw new Error('file input should be available')
  fireEvent.change(input, {
    target: { files: [file] },
  })
}

describe('ImportSkillModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.existingNames = new Set()
    useAppStore.setState({
      appDetail: { id: 'app-1' } as App & Partial<AppSSO>,
    })
  })

  describe('Rendering', () => {
    it('should render drop zone and keep import button disabled when no file is selected', () => {
      render(<ImportSkillModal isOpen onClose={vi.fn()} />)

      expect(screen.getByText('workflow.skill.startTab.importModal.dropHint')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /workflow\.skill\.startTab\.importModal\.importButton/i })).toBeDisabled()
    })
  })

  describe('File Validation', () => {
    it('should reject non-zip file selection and show error toast', () => {
      render(<ImportSkillModal isOpen onClose={vi.fn()} />)

      selectFile(new File(['readme'], 'README.md', { type: 'text/markdown' }))

      expect(mocks.toastNotify).toHaveBeenCalledWith({
        type: 'error',
        message: 'workflow.skill.startTab.importModal.invalidFileType',
      })
      expect(screen.getByRole('button', { name: /workflow\.skill\.startTab\.importModal\.importButton/i })).toBeDisabled()
    })

    it('should show selected zip filename and formatted size after file is chosen', () => {
      render(<ImportSkillModal isOpen onClose={vi.fn()} />)

      selectFile(createZipFile('sample.zip', 1536))

      expect(screen.getByText('sample.zip')).toBeInTheDocument()
      expect(screen.getByText('1.5 KB')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /workflow\.skill\.startTab\.importModal\.importButton/i })).not.toBeDisabled()
    })

    it('should select a zip file when it is dropped on the drop zone', () => {
      render(<ImportSkillModal isOpen onClose={vi.fn()} />)

      const dropHint = screen.getByText('workflow.skill.startTab.importModal.dropHint')
      const dropZone = dropHint.closest('div')
      expect(dropZone).not.toBeNull()

      fireEvent.dragOver(dropZone as HTMLDivElement, { dataTransfer: { files: [] } })
      fireEvent.drop(dropZone as HTMLDivElement, {
        dataTransfer: {
          files: [createZipFile('dropped.zip', 2048)],
        },
      })

      expect(screen.getByText('dropped.zip')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /workflow\.skill\.startTab\.importModal\.importButton/i })).not.toBeDisabled()
    })

    it('should trigger hidden file input click when drop zone is clicked', () => {
      const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined)
      render(<ImportSkillModal isOpen onClose={vi.fn()} />)

      const dropHint = screen.getByText('workflow.skill.startTab.importModal.dropHint')
      const dropZone = dropHint.closest('div')
      expect(dropZone).not.toBeNull()

      fireEvent.click(dropZone as HTMLDivElement)

      expect(clickSpy).toHaveBeenCalledTimes(1)
      clickSpy.mockRestore()
    })

    it('should trigger hidden file input click when change-file button is clicked', () => {
      const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined)
      render(<ImportSkillModal isOpen onClose={vi.fn()} />)

      selectFile(createZipFile('selected.zip', 1024))
      fireEvent.click(screen.getByRole('button', { name: /workflow\.skill\.startTab\.importModal\.changeFile/i }))

      expect(clickSpy).toHaveBeenCalledTimes(1)
      clickSpy.mockRestore()
    })
  })

  describe('Import Flow', () => {
    it('should import selected zip and open SKILL.md tab when upload succeeds', async () => {
      const onClose = vi.fn()
      mocks.extractAndValidateZip.mockResolvedValueOnce({
        rootFolderName: 'new-skill',
        files: new Map([['new-skill/SKILL.md', new Uint8Array([1, 2, 3])]]),
      })
      mocks.buildUploadDataFromZip.mockResolvedValueOnce({
        tree: [{ name: 'new-skill', node_type: 'folder', children: [] }],
        files: new Map([['new-skill/SKILL.md', new File(['content'], 'SKILL.md')]]),
      })
      mocks.mutateAsync.mockImplementationOnce(async ({ onProgress }: { onProgress?: (uploaded: number, total: number) => void }) => {
        onProgress?.(1, 1)
        return [{
          children: [{ id: 'skill-md-id', name: 'SKILL.md' }],
        }]
      })

      render(<ImportSkillModal isOpen onClose={onClose} />)
      selectFile(createZipFile('new-skill.zip', 2048))
      fireEvent.click(screen.getByRole('button', { name: /workflow\.skill\.startTab\.importModal\.importButton/i }))

      await waitFor(() => {
        expect(mocks.mutateAsync).toHaveBeenCalledTimes(1)
      })

      expect(mocks.workflowState.setUploadStatus).toHaveBeenNthCalledWith(1, 'uploading')
      expect(mocks.workflowState.setUploadStatus).toHaveBeenNthCalledWith(2, 'success')
      expect(mocks.workflowState.setUploadProgress).toHaveBeenCalledWith({ uploaded: 0, total: 0, failed: 0 })
      expect(mocks.workflowState.setUploadProgress).toHaveBeenCalledWith({ uploaded: 0, total: 1, failed: 0 })
      expect(mocks.workflowState.setUploadProgress).toHaveBeenCalledWith({ uploaded: 1, total: 1, failed: 0 })
      expect(mocks.emitTreeUpdate).toHaveBeenCalledTimes(1)
      expect(mocks.workflowState.openTab).toHaveBeenCalledWith('skill-md-id', { pinned: true })
      expect(mocks.toastNotify).toHaveBeenCalledWith({
        type: 'success',
        message: 'workflow.skill.startTab.importModal.importSuccess:{"name":"new-skill"}',
      })
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('should stop import and notify duplicate folder name when extracted root already exists', async () => {
      mocks.existingNames = new Set(['existing-skill'])
      mocks.extractAndValidateZip.mockResolvedValueOnce({
        rootFolderName: 'existing-skill',
        files: new Map([['existing-skill/SKILL.md', new Uint8Array([1])]]),
      })
      render(<ImportSkillModal isOpen onClose={vi.fn()} />)

      selectFile(createZipFile('existing-skill.zip'))
      fireEvent.click(screen.getByRole('button', { name: /workflow\.skill\.startTab\.importModal\.importButton/i }))

      await waitFor(() => {
        expect(mocks.workflowState.setUploadStatus).toHaveBeenCalledWith('partial_error')
      })

      expect(mocks.toastNotify).toHaveBeenCalledWith({
        type: 'error',
        message: 'workflow.skill.startTab.importModal.nameDuplicate',
      })
      expect(mocks.buildUploadDataFromZip).not.toHaveBeenCalled()
      expect(mocks.mutateAsync).not.toHaveBeenCalled()
    })

    it('should not start import when app id is missing', () => {
      useAppStore.setState({ appDetail: undefined })
      render(<ImportSkillModal isOpen onClose={vi.fn()} />)

      selectFile(createZipFile('new-skill.zip', 2048))
      fireEvent.click(screen.getByRole('button', { name: /workflow\.skill\.startTab\.importModal\.importButton/i }))

      expect(mocks.extractAndValidateZip).not.toHaveBeenCalled()
      expect(mocks.buildUploadDataFromZip).not.toHaveBeenCalled()
      expect(mocks.mutateAsync).not.toHaveBeenCalled()
      expect(mocks.workflowState.setUploadStatus).not.toHaveBeenCalled()
    })

    it('should map zip validation error code to localized error message', async () => {
      mocks.extractAndValidateZip.mockRejectedValueOnce(new ZipValidationError('empty_zip', 'empty zip'))
      render(<ImportSkillModal isOpen onClose={vi.fn()} />)

      selectFile(createZipFile())
      fireEvent.click(screen.getByRole('button', { name: /workflow\.skill\.startTab\.importModal\.importButton/i }))

      await waitFor(() => {
        expect(mocks.workflowState.setUploadStatus).toHaveBeenCalledWith('partial_error')
      })

      expect(mocks.toastNotify).toHaveBeenCalledWith({
        type: 'error',
        message: 'workflow.skill.startTab.importModal.errorEmptyZip',
      })
    })

    it('should fallback to raw error message when zip validation code is unknown', async () => {
      const unknownCodeError = new ZipValidationError('invalid_zip', 'custom zip error')
      ;(unknownCodeError as unknown as { code: string }).code = 'unknown_code'
      mocks.extractAndValidateZip.mockRejectedValueOnce(unknownCodeError)
      render(<ImportSkillModal isOpen onClose={vi.fn()} />)

      selectFile(createZipFile())
      fireEvent.click(screen.getByRole('button', { name: /workflow\.skill\.startTab\.importModal\.importButton/i }))

      await waitFor(() => {
        expect(mocks.workflowState.setUploadStatus).toHaveBeenCalledWith('partial_error')
      })

      expect(mocks.toastNotify).toHaveBeenCalledWith({
        type: 'error',
        message: 'custom zip error',
      })
    })

    it('should fallback to invalid zip error when import fails with non-validation error', async () => {
      mocks.extractAndValidateZip.mockRejectedValueOnce(new Error('unknown'))
      render(<ImportSkillModal isOpen onClose={vi.fn()} />)

      selectFile(createZipFile())
      fireEvent.click(screen.getByRole('button', { name: /workflow\.skill\.startTab\.importModal\.importButton/i }))

      await waitFor(() => {
        expect(mocks.workflowState.setUploadStatus).toHaveBeenCalledWith('partial_error')
      })

      expect(mocks.toastNotify).toHaveBeenCalledWith({
        type: 'error',
        message: 'workflow.skill.startTab.importModal.errorInvalidZip',
      })
    })
  })
})
