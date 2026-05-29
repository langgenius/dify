import type { FileUpload } from '@/app/components/base/features/types'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import FileUploaderInAttachmentWrapper from '@/app/components/base/file-uploader/file-uploader-in-attachment'
import FileUploaderInChatInput from '@/app/components/base/file-uploader/file-uploader-in-chat-input'
import { FileContextProvider } from '@/app/components/base/file-uploader/store'
import { TransferMethod } from '@/types/app'

const mockUploadRemoteFileInfo = vi.fn()

vi.mock('@/next/navigation', () => ({
  useParams: () => ({}),
}))

vi.mock('@/service/common', () => ({
  uploadRemoteFileInfo: (...args: unknown[]) => mockUploadRemoteFileInfo(...args),
}))

const createFileConfig = (overrides: Partial<FileUpload> = {}): FileUpload => ({
  enabled: true,
  allowed_file_types: ['document'],
  allowed_file_extensions: [],
  allowed_file_upload_methods: [TransferMethod.remote_url],
  number_limits: 5,
  preview_config: {
    enabled: false,
    mode: 'current_page',
    file_type_list: [],
  },
  ...overrides,
} as FileUpload)

const renderChatInput = (fileConfig: FileUpload, readonly = false) => {
  return render(
    <FileContextProvider>
      <FileUploaderInChatInput fileConfig={fileConfig} readonly={readonly} />
    </FileContextProvider>,
  )
}

describe('Base File Uploader Flow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUploadRemoteFileInfo.mockResolvedValue({
      id: 'remote-file-1',
      mime_type: 'application/pdf',
      size: 2048,
      name: 'guide.pdf',
      url: 'https://cdn.example.com/guide.pdf',
    })
  })

  it('uploads a remote file from the attachment wrapper and pushes the updated file list to consumers', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(
      <FileUploaderInAttachmentWrapper
        value={[]}
        onChange={onChange}
        fileConfig={createFileConfig()}
      />,
    )

    await user.click(screen.getByRole('button', { name: /fileUploader\.pasteFileLink/i }))
    await user.type(screen.getByPlaceholderText(/fileUploader\.pasteFileLinkInputPlaceholder/i), 'https://example.com/guide.pdf')
    await user.click(screen.getByRole('button', { name: /operation\.ok/i }))

    await waitFor(() => {
      expect(mockUploadRemoteFileInfo).toHaveBeenCalledWith('https://example.com/guide.pdf', false)
    })

    await waitFor(() => {
      expect(onChange).toHaveBeenLastCalledWith([
        expect.objectContaining({
          name: 'https://example.com/guide.pdf',
          uploadedId: 'remote-file-1',
          url: 'https://cdn.example.com/guide.pdf',
          progress: 100,
        }),
      ])
    })

    expect(screen.getByText('https://example.com/guide.pdf')).toBeInTheDocument()
  })

  it('opens the link picker from chat input and keeps the trigger disabled in readonly mode', async () => {
    const user = userEvent.setup()
    const fileConfig = createFileConfig()

    const { unmount } = renderChatInput(fileConfig)

    const activeTrigger = screen.getByRole('button')
    expect(activeTrigger).toBeEnabled()

    await user.click(activeTrigger)
    expect(screen.getByPlaceholderText(/fileUploader\.pasteFileLinkInputPlaceholder/i)).toBeInTheDocument()
    expect(screen.queryByText(/fileUploader\.uploadFromComputer/i)).not.toBeInTheDocument()

    unmount()
    renderChatInput(fileConfig, true)

    expect(screen.getByRole('button')).toBeDisabled()
  })
})
