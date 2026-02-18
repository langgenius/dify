import { downloadBlob, downloadUrl } from './download'

describe('downloadUrl', () => {
  let mockAnchor: HTMLAnchorElement

  beforeEach(() => {
    mockAnchor = {
      href: '',
      download: '',
      rel: '',
      target: '',
      style: { display: '' },
      click: vi.fn(),
      remove: vi.fn(),
    } as unknown as HTMLAnchorElement

    vi.spyOn(document, 'createElement').mockReturnValue(mockAnchor)
    vi.spyOn(document.body, 'appendChild').mockImplementation((node: Node) => node)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should create a link and trigger a download correctly', () => {
    downloadUrl({ url: 'https://example.com/file.txt', fileName: 'file.txt', target: '_blank' })

    expect(mockAnchor.href).toBe('https://example.com/file.txt')
    expect(mockAnchor.download).toBe('file.txt')
    expect(mockAnchor.rel).toBe('noopener noreferrer')
    expect(mockAnchor.target).toBe('_blank')
    expect(mockAnchor.style.display).toBe('none')
    expect(mockAnchor.click).toHaveBeenCalled()
    expect(mockAnchor.remove).toHaveBeenCalled()
  })

  it('should skip when url is empty', () => {
    downloadUrl({ url: '' })
    expect(document.createElement).not.toHaveBeenCalled()
  })
})

describe('downloadBlob', () => {
  it('should create a blob url, trigger download, and revoke url', () => {
    const blob = new Blob(['test'], { type: 'text/plain' })
    const mockUrl = 'blob:mock-url'
    const createObjectURLMock = vi.spyOn(window.URL, 'createObjectURL').mockReturnValue(mockUrl)
    const revokeObjectURLMock = vi.spyOn(window.URL, 'revokeObjectURL').mockImplementation(() => {})

    const mockAnchor = {
      href: '',
      download: '',
      rel: '',
      target: '',
      style: { display: '' },
      click: vi.fn(),
      remove: vi.fn(),
    } as unknown as HTMLAnchorElement

    vi.spyOn(document, 'createElement').mockReturnValue(mockAnchor)
    vi.spyOn(document.body, 'appendChild').mockImplementation((node: Node) => node)

    downloadBlob({ data: blob, fileName: 'file.txt' })

    expect(createObjectURLMock).toHaveBeenCalledWith(blob)
    expect(mockAnchor.href).toBe(mockUrl)
    expect(mockAnchor.download).toBe('file.txt')
    expect(mockAnchor.rel).toBe('noopener noreferrer')
    expect(mockAnchor.click).toHaveBeenCalled()
    expect(mockAnchor.remove).toHaveBeenCalled()
    expect(revokeObjectURLMock).toHaveBeenCalledWith(mockUrl)

    vi.restoreAllMocks()
  })
})
