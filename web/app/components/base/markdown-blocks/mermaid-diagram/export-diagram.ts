export function serializeDiagram(svg: SVGSVGElement, theme: Element = svg): string {
  const copy = svg.cloneNode(true) as SVGSVGElement
  const computed = getComputedStyle(theme)
  // Export the complete drawing, independent of the current pan/zoom viewport.
  const width = svg.getAttribute('width')!
  const height = svg.getAttribute('height')!
  copy.setAttribute('viewBox', `0 0 ${width} ${height}`)
  copy.style.width = `${width}px`
  copy.style.height = `${height}px`
  copy.style.maxWidth = 'none'
  copy.style.margin = '0'
  copy.style.backgroundColor = computed.getPropertyValue('--pele-bg')
  copy.removeAttribute('tabindex')
  // Standalone SVGs cannot inherit the host application's theme variables.
  for (const property of computed) {
    if (property.startsWith('--pele-'))
      copy.style.setProperty(property, computed.getPropertyValue(property))
  }
  return new XMLSerializer().serializeToString(copy)
}

export async function diagramPng(svg: string): Promise<Blob> {
  const image = new Image()
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  await image.decode()
  // Bound bitmap allocation for large diagrams while preserving their aspect ratio.
  const scale = Math.min(
    1,
    8192 / image.naturalWidth,
    8192 / image.naturalHeight,
    Math.sqrt(16_000_000 / (image.naturalWidth * image.naturalHeight)),
  )
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas is unavailable')
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('PNG encoding failed'))),
      'image/png',
    )
  })
}
