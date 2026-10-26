import { vi } from 'vite-plus/test'

/** Capture browser downloads without navigating away from the test document. */
export const captureDownloads = () => {
  const blobs = new Map<string, Blob>()
  const downloads: { filename: string; blob: Blob }[] = []
  vi.spyOn(URL, 'createObjectURL').mockImplementation((value) => {
    if (!(value instanceof Blob)) throw new Error('Expected a downloadable Blob')
    const url = `blob:test-download-${blobs.size}`
    blobs.set(url, value)
    return url
  })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    const blob = blobs.get(this.href)
    if (!blob) throw new Error(`Download URL was not created from a Blob: ${this.href}`)
    downloads.push({ filename: this.download, blob })
  })
  return downloads
}
