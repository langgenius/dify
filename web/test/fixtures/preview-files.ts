// A complete, local PDF lets preview tests exercise the real loader, worker and canvas.
export function createPreviewPdf(name = 'guide.pdf') {
  const content = 'BT /F1 24 Tf 40 180 Td (Dify local preview) Tj ET'
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 320 240] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ]
  let pdf = '%PDF-1.4\n'
  const offsets = [0]
  objects.forEach((object, index) => {
    offsets.push(pdf.length)
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xref = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  pdf += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('')
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  return new File([pdf], name, { type: 'application/pdf' })
}

export const previewImage = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="60"><rect width="80" height="60" fill="blue"/></svg>',
)}`

/** Only locally allocated preview data may reach native fetch; backend traffic is a test failure. */
export function guardPreviewFetch() {
  const nativeFetch = globalThis.fetch.bind(globalThis)
  const unexpected = vi.fn()
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input)
    if (url.startsWith('blob:') || url.startsWith('data:')) return nativeFetch(input, init)
    unexpected(url)
    return Promise.reject(new Error(`Unexpected preview request: ${url}`))
  })
  return () => {
    try {
      expect(unexpected).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  }
}

// PDF.js has no accessible canvas role. Read its public painted output, not SDK classes or state.
export function hasPaintedPdfText(preview: Element) {
  const canvas = preview.querySelector('canvas')
  if (!canvas?.width || !canvas.height) return false
  const pixels = canvas.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height).data
  if (!pixels) return false
  for (let index = 0; index < pixels.length; index += 4) {
    if (pixels[index + 3]! > 0 && pixels[index]! < 128) return true
  }
  return false
}
