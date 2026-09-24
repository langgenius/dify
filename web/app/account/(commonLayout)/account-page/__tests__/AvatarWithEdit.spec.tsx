import type { OnImageInput } from '@/app/components/base/app-icon-picker/ImageInput'
import type { ImageFile } from '@/types/app'
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createTestQueryClient } from '@/test/query-client'
import { TransferMethod } from '@/types/app'
import { createCroppedAvatarImage } from '../avatar-image'
import AvatarWithEdit from '../AvatarWithEdit'

type LocalFileUploaderOptions = {
  onUpload: (imageFile: ImageFile) => void
}

const mocks = vi.hoisted(() => ({
  animatedFile: new File(['animated'], 'avatar.gif', { type: 'image/gif' }),
  handleLocalFileUpload: vi.fn<(file: File) => void>(),
  onUpload: null as ((imageFile: ImageFile) => void) | null,
  request: vi.fn(),
}))

vi.mock('@/config', () => ({
  API_PREFIX: '/console/api',
  DISABLE_UPLOAD_IMAGE_AS_ICON: false,
}))

vi.mock('@/service/base', () => ({
  request: mocks.request,
}))

vi.mock('@/app/components/base/app-icon-picker/ImageInput', () => ({
  default: ({ onImageInput }: { onImageInput?: OnImageInput }) => (
    <div>
      <button
        type="button"
        onClick={() =>
          onImageInput?.(
            true,
            'blob:static-avatar',
            { x: 10, y: 20, width: 1000, height: 1000 },
            'avatar.png',
          )
        }
      >
        Select static avatar
      </button>
      <button type="button" onClick={() => onImageInput?.(false, mocks.animatedFile)}>
        Select animated avatar
      </button>
    </div>
  ),
}))

vi.mock('@/app/components/base/image-uploader/hooks', () => ({
  useLocalFileUploader: (options: LocalFileUploaderOptions) => {
    mocks.onUpload = options.onUpload
    return { handleLocalFileUpload: mocks.handleLocalFileUpload }
  },
}))

vi.mock('../avatar-image', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../avatar-image')>()
  return {
    ...actual,
    createCroppedAvatarImage: vi.fn(),
  }
})

const mockedCreateCroppedAvatarImage = vi.mocked(createCroppedAvatarImage)

const createImageFile = (fileId = 'uploaded-avatar-id'): ImageFile => ({
  type: TransferMethod.local_file,
  _id: 'test-image-id',
  fileId,
  progress: 100,
  url: 'https://example.com/avatar.png',
})

const createAccountResponse = (avatar = '') => ({
  id: 'user-id',
  name: 'Alice',
  email: 'alice@example.com',
  avatar,
  avatar_url: avatar ? 'https://example.com/avatar.png' : null,
  is_password_set: false,
})

const renderAvatar = (avatar: string | null = null) => {
  const queryClient = createTestQueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <AvatarWithEdit avatar={avatar} name="Alice" size="3xl" />
    </QueryClientProvider>,
  )
}

describe('AvatarWithEdit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.onUpload = null
    mocks.request.mockImplementation(
      async () =>
        new Response(JSON.stringify(createAccountResponse('uploaded-avatar-id')), {
          headers: { 'content-type': 'application/json' },
        }),
    )
  })

  it('uploads the bounded crop for a static avatar', async () => {
    const user = userEvent.setup()
    const blob = new Blob(['bounded-avatar'], { type: 'image/png' })
    mockedCreateCroppedAvatarImage.mockResolvedValue(blob)
    renderAvatar()

    await user.click(screen.getByRole('button', { name: /avatar\.editAction/i }))
    await user.click(screen.getByRole('button', { name: 'Select static avatar' }))
    await user.click(screen.getByRole('button', { name: /iconPicker\.ok/i }))

    await waitFor(() => {
      expect(mockedCreateCroppedAvatarImage).toHaveBeenCalledWith(
        'blob:static-avatar',
        { x: 10, y: 20, width: 1000, height: 1000 },
        'avatar.png',
      )
      expect(mocks.handleLocalFileUpload).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'avatar.png', type: 'image/png' }),
      )
    })
  })

  it('updates an animated avatar through the account profile endpoint', async () => {
    const user = userEvent.setup()
    const uploadedAvatar = createImageFile()
    mocks.handleLocalFileUpload.mockImplementation(() => mocks.onUpload?.(uploadedAvatar))
    renderAvatar()

    await user.click(screen.getByRole('button', { name: /avatar\.editAction/i }))
    await user.click(screen.getByRole('button', { name: 'Select animated avatar' }))
    await user.click(screen.getByRole('button', { name: /iconPicker\.ok/i }))

    expect(mockedCreateCroppedAvatarImage).not.toHaveBeenCalled()
    expect(mocks.handleLocalFileUpload).toHaveBeenCalledWith(mocks.animatedFile)
    await waitFor(() => {
      expect(mocks.request).toHaveBeenCalled()
    })
    expect(mocks.request.mock.calls[0]?.[0]).toEqual(expect.stringContaining('/account/profile'))
    const request = mocks.request.mock.calls[0]?.[2]?.request as Request
    expect(request.method).toBe('PATCH')
    await expect(request.json()).resolves.toEqual({ avatar: uploadedAvatar.fileId })
  })

  it('clears the avatar through the account profile endpoint', async () => {
    const user = userEvent.setup()
    renderAvatar('data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==')

    await user.click(screen.getByRole('button', { name: /avatar\.editAction/i }))
    await user.click(screen.getByRole('button', { name: /operation\.delete/i }))
    await user.click(await screen.findByRole('button', { name: /operation\.delete/i }))

    await waitFor(() => {
      expect(mocks.request).toHaveBeenCalled()
    })
    expect(mocks.request.mock.calls[0]?.[0]).toEqual(expect.stringContaining('/account/profile'))
    const request = mocks.request.mock.calls[0]?.[2]?.request as Request
    expect(request.method).toBe('PATCH')
    await expect(request.json()).resolves.toEqual({ avatar: '' })
  })
})
