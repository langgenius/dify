import { downloadBlob, downloadUrl } from './download'

afterEach(() => vi.restoreAllMocks())

it('downloads a URL with its filename and safe external-link attributes, then removes the link', () => {
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    expect(this).toBeInTheDocument()
  })

  downloadUrl({ url: 'https://example.com/file.txt', fileName: 'file.txt', target: '_blank' })

  const clicked = click.mock.contexts[0] as HTMLAnchorElement
  expect(clicked.href).toBe('https://example.com/file.txt')
  expect(clicked.download).toBe('file.txt')
  expect(clicked.rel).toBe('noopener noreferrer')
  expect(clicked.target).toBe('_blank')
  expect(clicked).not.toBeInTheDocument()
})

it('skips downloading an empty URL', () => {
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  downloadUrl({ url: '' })
  expect(click).not.toHaveBeenCalled()
})

it('downloads a blob and releases its temporary URL after activating the link', () => {
  const blob = new Blob(['test'], { type: 'text/plain' })
  const createURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:avatar')
  const revokeURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    expect(this.href).toBe('blob:avatar')
    expect(this.download).toBe('file.txt')
    expect(revokeURL).not.toHaveBeenCalled()
  })

  downloadBlob({ data: blob, fileName: 'file.txt' })

  const clicked = click.mock.contexts[0] as HTMLAnchorElement
  expect(createURL).toHaveBeenCalledWith(blob)
  expect(revokeURL).toHaveBeenCalledWith('blob:avatar')
  expect(clicked).not.toBeInTheDocument()
})
