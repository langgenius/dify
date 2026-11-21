import { QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { imageUpload } from '@/app/components/base/image-uploader/utils'
import { createTestQueryClient } from '@/test/query-client'
import { createCroppedAvatarImage } from '../avatar-image'
import AvatarWithEdit from '../AvatarWithEdit'

const mocks = vi.hoisted(() => ({
  imageUpload: vi.fn(),
  request: vi.fn(),
}))

vi.mock('@/config', () => ({
  API_PREFIX: '/console/api',
  DISABLE_UPLOAD_IMAGE_AS_ICON: false,
}))

vi.mock('@/next/navigation', () => ({
  useParams: () => ({}),
}))

vi.mock('@/service/base', () => ({
  request: mocks.request,
}))

vi.mock('@/app/components/base/image-uploader/utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/components/base/image-uploader/utils')>()),
  imageUpload: mocks.imageUpload,
}))

vi.mock('../avatar-image', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../avatar-image')>()
  return {
    ...actual,
    // avatar-image.spec.ts independently verifies bitmap cropping and output size bounds.
    createCroppedAvatarImage: vi.fn(),
  }
})

const mockedImageUpload = vi.mocked(imageUpload)
const mockedCreateCroppedAvatarImage = vi.mocked(createCroppedAvatarImage)

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

const expectProfilePatch = async (avatar: string) => {
  await waitFor(() => expect(mocks.request).toHaveBeenCalled())
  expect(mocks.request.mock.calls[0]?.[0]).toEqual(expect.stringContaining('/account/profile'))
  const request = mocks.request.mock.calls[0]?.[2]?.request as Request
  expect(request.method).toBe('PATCH')
  await expect(request.json()).resolves.toEqual({ avatar })
}

describe('AvatarWithEdit', () => {
  beforeEach(() => {
    mocks.imageUpload.mockReset()
    mocks.request.mockReset().mockImplementation(
      async () =>
        new Response(JSON.stringify(createAccountResponse('uploaded-avatar-id')), {
          headers: { 'content-type': 'application/json' },
        }),
    )
    mockedCreateCroppedAvatarImage.mockReset()
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:avatar-preview')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  })

  afterEach(() => vi.restoreAllMocks())

  it('uploads the bounded crop for a static avatar', async () => {
    const user = userEvent.setup()
    const croppedBlob = new Blob(['bounded-avatar'], { type: 'image/png' })
    const selectedFile = new File(['static-avatar'], 'avatar.png', { type: 'image/png' })
    mockedCreateCroppedAvatarImage.mockResolvedValue(croppedBlob)
    renderAvatar()

    await user.click(screen.getByRole('button', { name: /avatar\.editAction/i }))
    const dialog = screen.getByRole('dialog', { name: /avatar\.editAction/i })
    const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      return dialog.contains(this)
        ? new DOMRect(0, 0, 320, 320)
        : originalGetBoundingClientRect.call(this)
    })
    await user.upload(screen.getByTestId('image-input'), selectedFile)
    await screen.findByRole('group', { name: /iconPicker\.crop/i })
    // The library image has no accessible name; select it only to supply native load/geometry.
    const cropperImage = dialog.querySelector('img')
    if (!cropperImage) throw new Error('Expected the real cropper image')
    Object.defineProperties(cropperImage, {
      naturalWidth: { value: 1200, configurable: true },
      naturalHeight: { value: 600, configurable: true },
      width: { value: 320, configurable: true },
      height: { value: 160, configurable: true },
      offsetWidth: { value: 320, configurable: true },
      offsetHeight: { value: 160, configurable: true },
    })
    vi.spyOn(cropperImage, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 80, 320, 160))
    fireEvent.load(cropperImage)
    await user.click(screen.getByRole('button', { name: /iconPicker\.ok/i }))

    await waitFor(() => expect(mockedCreateCroppedAvatarImage).toHaveBeenCalled())
    expect(mockedCreateCroppedAvatarImage).toHaveBeenCalledWith(
      'blob:avatar-preview',
      { x: 300, y: 0, width: 600, height: 600 },
      'avatar.png',
    )
    await waitFor(() => expect(mockedImageUpload).toHaveBeenCalledOnce())
    expect(mockedImageUpload.mock.calls[0]![0].file).toEqual(
      expect.objectContaining({ name: 'avatar.png', type: 'image/png' }),
    )
    expect(
      Array.from(new Uint8Array(await mockedImageUpload.mock.calls[0]![0].file.arrayBuffer())),
    ).toEqual(Array.from(new Uint8Array(await croppedBlob.arrayBuffer())))
    act(() => mockedImageUpload.mock.calls[0]![0].onSuccessCallback({ id: 'cropped-avatar-id' }))

    await expectProfilePatch('cropped-avatar-id')
    await waitFor(() => expect(dialog).not.toBeInTheDocument())
  })

  it('updates an animated avatar through the account profile endpoint', async () => {
    const user = userEvent.setup()
    const animatedFile = new File(['GIF89a'], 'avatar.gif', { type: 'image/gif' })
    renderAvatar()

    await user.click(screen.getByRole('button', { name: /avatar\.editAction/i }))
    const dialog = screen.getByRole('dialog', { name: /avatar\.editAction/i })
    await user.upload(screen.getByTestId('image-input'), animatedFile)
    expect(await screen.findByRole('img', { name: /iconPicker\.image/i })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /iconPicker\.ok/i }))

    expect(mockedCreateCroppedAvatarImage).not.toHaveBeenCalled()
    await waitFor(() => expect(mockedImageUpload).toHaveBeenCalledOnce())
    expect(mockedImageUpload.mock.calls[0]![0].file).toBe(animatedFile)
    act(() => mockedImageUpload.mock.calls[0]![0].onSuccessCallback({ id: 'animated-avatar-id' }))

    await expectProfilePatch('animated-avatar-id')
    await waitFor(() => expect(dialog).not.toBeInTheDocument())
  })

  it('clears a saved avatar even after its image fails to load', async () => {
    const images: HTMLImageElement[] = []
    const NativeImage = window.Image
    vi.spyOn(window, 'Image').mockImplementation(
      class extends NativeImage {
        constructor() {
          super()
          images.push(this)
        }
      },
    )
    const user = userEvent.setup()
    renderAvatar('https://example.com/broken.png')
    await waitFor(() => expect(images.length).toBeGreaterThan(0))
    act(() => {
      for (const image of images) image.dispatchEvent(new Event('error'))
    })

    await user.click(screen.getByRole('button', { name: /avatar\.editAction/i }))
    await user.click(screen.getByRole('button', { name: /operation\.delete/i }))
    const confirmDialog = await screen.findByRole('dialog', { name: /avatar\.deleteTitle/i })
    await user.click(screen.getByRole('button', { name: /operation\.delete/i }))

    await expectProfilePatch('')
    await waitFor(() => expect(confirmDialog).not.toBeInTheDocument())
  })
})
