import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ZipValidationError } from '../../utils/zip-extract'
import ImportSkillModal from '.././import-skill-modal'

const mocks = vi.hoisted(() => ({
  appId: 'app-1',
  extractAndValidateZip: vi.fn(),
  buildUploadDataFromZip: vi.fn(),
  startUpload: vi.fn(),
  setUploadProgress: vi.fn(),
  failUpload: vi.fn(),
  uploadTree: vi.fn(),
  openCreatedSkillDocument: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  existingNames: new Set<string>(),
}))

vi.mock('../../utils/zip-extract', () => {
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

vi.mock('../../utils/zip-to-upload-tree', () => ({
  buildUploadDataFromZip: (...args: unknown[]) => mocks.buildUploadDataFromZip(...args),
}))

vi.mock('../../hooks/file-tree/data/use-skill-asset-tree', () => ({
  useExistingSkillNames: () => ({
    data: mocks.existingNames,
  }),
}))

vi.mock('.././use-skill-batch-upload', () => ({
  useSkillBatchUpload: () => ({
    appId: mocks.appId,
    startUpload: mocks.startUpload,
    setUploadProgress: mocks.setUploadProgress,
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
    mocks.appId = 'app-1'
    mocks.uploadTree.mockResolvedValue([])
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

      expect(mocks.toastError).toHaveBeenCalledWith('workflow.skill.startTab.importModal.invalidFileType')
      expect(mocks.toastSuccess).not.toHaveBeenCalled()
      expect(screen.getByRole('button', { name: /workflow\.skill\.startTab\.importModal\.importButton/i })).toBeDisabled()
    })

    it('should show selected zip filename and formatted size after file is chosen', () => {
      render(<ImportSkillModal isOpen onClose={vi.fn()} />)

      selectFile(createZipFile('sample.zip', 1536))

      expect(screen.getByText('sample.zip')).toBeInTheDocument()
      expect(screen.getByText('1.5 KB')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /workflow\.skill\.startTab\.importModal\.importButton/i })).not.toBeDisabled()
    })

    it('should format small files in bytes and large files in megabytes', () => {
      const { rerender } = render(<ImportSkillModal isOpen onClose={vi.fn()} />)

      selectFile(createZipFile('tiny.zip', 512))
      expect(screen.getByText('512 B')).toBeInTheDocument()

      rerender(<ImportSkillModal isOpen onClose={vi.fn()} />)
      selectFile(createZipFile('large.zip', 2 * 1024 * 1024))
      expect(screen.getByText('2.0 MB')).toBeInTheDocument()
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
      mocks.uploadTree.mockResolvedValueOnce([
        { id: 'skill-folder-id', name: 'new-skill', node_type: 'folder', size: 0, children: [] },
      ])

      render(<ImportSkillModal isOpen onClose={onClose} />)
      selectFile(createZipFile('new-skill.zip', 2048))
      fireEvent.click(screen.getByRole('button', { name: /workflow\.skill\.startTab\.importModal\.importButton/i }))

      await waitFor(() => {
        expect(mocks.uploadTree).toHaveBeenCalledTimes(1)
      })

      expect(mocks.startUpload).toHaveBeenCalledWith(0)
      expect(mocks.setUploadProgress).toHaveBeenCalledWith(0, 1)
      expect(mocks.openCreatedSkillDocument).toHaveBeenCalledWith([
        { id: 'skill-folder-id', name: 'new-skill', node_type: 'folder', size: 0, children: [] },
      ])
      expect(mocks.toastSuccess).toHaveBeenCalledWith('workflow.skill.startTab.importModal.importSuccess:{"name":"new-skill"}')
      expect(mocks.toastError).not.toHaveBeenCalled()
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
        expect(mocks.failUpload).toHaveBeenCalledTimes(1)
      })

      expect(mocks.toastError).toHaveBeenCalledWith('workflow.skill.startTab.importModal.nameDuplicate')
      expect(mocks.toastSuccess).not.toHaveBeenCalled()
      expect(mocks.buildUploadDataFromZip).not.toHaveBeenCalled()
      expect(mocks.uploadTree).not.toHaveBeenCalled()
    })

    it('should not start import when app id is missing', () => {
      mocks.appId = ''
      render(<ImportSkillModal isOpen onClose={vi.fn()} />)

      selectFile(createZipFile('new-skill.zip', 2048))
      fireEvent.click(screen.getByRole('button', { name: /workflow\.skill\.startTab\.importModal\.importButton/i }))

      expect(mocks.extractAndValidateZip).not.toHaveBeenCalled()
      expect(mocks.buildUploadDataFromZip).not.toHaveBeenCalled()
      expect(mocks.uploadTree).not.toHaveBeenCalled()
      expect(mocks.startUpload).not.toHaveBeenCalled()
    })

    it('should map zip validation error code to localized error message', async () => {
      mocks.extractAndValidateZip.mockRejectedValueOnce(new ZipValidationError('empty_zip', 'empty zip'))
      render(<ImportSkillModal isOpen onClose={vi.fn()} />)

      selectFile(createZipFile())
      fireEvent.click(screen.getByRole('button', { name: /workflow\.skill\.startTab\.importModal\.importButton/i }))

      await waitFor(() => {
        expect(mocks.failUpload).toHaveBeenCalledTimes(1)
      })

      expect(mocks.toastError).toHaveBeenCalledWith('workflow.skill.startTab.importModal.errorEmptyZip')
      expect(mocks.toastSuccess).not.toHaveBeenCalled()
    })

    it('should fallback to raw error message when zip validation code is unknown', async () => {
      const unknownCodeError = new ZipValidationError('invalid_zip', 'custom zip error')
      ;(unknownCodeError as unknown as { code: string }).code = 'unknown_code'
      mocks.extractAndValidateZip.mockRejectedValueOnce(unknownCodeError)
      render(<ImportSkillModal isOpen onClose={vi.fn()} />)

      selectFile(createZipFile())
      fireEvent.click(screen.getByRole('button', { name: /workflow\.skill\.startTab\.importModal\.importButton/i }))

      await waitFor(() => {
        expect(mocks.failUpload).toHaveBeenCalledTimes(1)
      })

      expect(mocks.toastError).toHaveBeenCalledWith('custom zip error')
      expect(mocks.toastSuccess).not.toHaveBeenCalled()
    })

    it('should fallback to invalid zip error when import fails with non-validation error', async () => {
      mocks.extractAndValidateZip.mockRejectedValueOnce(new Error('unknown'))
      render(<ImportSkillModal isOpen onClose={vi.fn()} />)

      selectFile(createZipFile())
      fireEvent.click(screen.getByRole('button', { name: /workflow\.skill\.startTab\.importModal\.importButton/i }))

      await waitFor(() => {
        expect(mocks.failUpload).toHaveBeenCalledTimes(1)
      })

      expect(mocks.toastError).toHaveBeenCalledWith('workflow.skill.startTab.importModal.errorInvalidZip')
      expect(mocks.toastSuccess).not.toHaveBeenCalled()
    })

    it('should keep the modal locked while an import is in progress', async () => {
      const onClose = vi.fn()
      let resolveArrayBuffer!: (value: ArrayBuffer) => void
      const file = createZipFile('pending.zip')
      Object.defineProperty(file, 'arrayBuffer', {
        value: vi.fn().mockImplementation(() => new Promise<ArrayBuffer>((resolve) => {
          resolveArrayBuffer = resolve
        })),
        configurable: true,
      })

      render(<ImportSkillModal isOpen onClose={onClose} />)
      selectFile(file)
      fireEvent.click(screen.getByRole('button', { name: /workflow\.skill\.startTab\.importModal\.importButton/i }))

      expect(screen.queryByRole('button', { name: /close/i })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: /common\.operation\.cancel/i })).toBeDisabled()

      fireEvent.click(screen.getByRole('button', { name: /common\.operation\.cancel/i }))
      expect(onClose).not.toHaveBeenCalled()

      resolveArrayBuffer(new ArrayBuffer(8))
      mocks.extractAndValidateZip.mockRejectedValueOnce(new Error('unknown'))

      await waitFor(() => {
        expect(mocks.failUpload).toHaveBeenCalledTimes(1)
      })
    })
  })
})
