import type { OnImageInput } from '@/app/components/base/app-icon-picker/ImageInput'
import type { ImageFile } from '@/types/app'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createCroppedAvatarImage } from '../avatar-image'
import AvatarWithEdit from '../AvatarWithEdit'

type LocalFileUploaderOptions = {
  onUpload: (imageFile: ImageFile) => void
}

const mocks = vi.hoisted(() => ({
  animatedFile: new File(['animated'], 'avatar.gif', { type: 'image/gif' }),
  handleLocalFileUpload: vi.fn<(file: File) => void>(),
}))

vi.mock('@/config', () => ({ DISABLE_UPLOAD_IMAGE_AS_ICON: false }))

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
  useLocalFileUploader: (_options: LocalFileUploaderOptions) => ({
    handleLocalFileUpload: mocks.handleLocalFileUpload,
  }),
}))

vi.mock('../avatar-image', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../avatar-image')>()
  return {
    ...actual,
    createCroppedAvatarImage: vi.fn(),
  }
})

const mockedCreateCroppedAvatarImage = vi.mocked(createCroppedAvatarImage)

describe('AvatarWithEdit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uploads the bounded crop for a static avatar', async () => {
    const user = userEvent.setup()
    const blob = new Blob(['bounded-avatar'], { type: 'image/png' })
    mockedCreateCroppedAvatarImage.mockResolvedValue(blob)
    render(<AvatarWithEdit avatar={null} name="Alice" size="3xl" />)

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

  it('keeps the existing original-file upload path for animated avatars', async () => {
    const user = userEvent.setup()
    render(<AvatarWithEdit avatar={null} name="Alice" size="3xl" />)

    await user.click(screen.getByRole('button', { name: /avatar\.editAction/i }))
    await user.click(screen.getByRole('button', { name: 'Select animated avatar' }))
    await user.click(screen.getByRole('button', { name: /iconPicker\.ok/i }))

    expect(mockedCreateCroppedAvatarImage).not.toHaveBeenCalled()
    expect(mocks.handleLocalFileUpload).toHaveBeenCalledWith(mocks.animatedFile)
  })
})
