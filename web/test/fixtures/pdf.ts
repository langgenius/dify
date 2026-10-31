/**
 * Minimal single-page PDF bytes for browser-mode PDF loading tests.
 *
 * The document is built as pure ASCII so that JavaScript string length and PDF
 * byte length are identical, which lets the cross-reference table be generated
 * with exact offsets instead of hand-counted ones.
 */

type PdfObject = string

function buildCrossReferencedPdf(objects: PdfObject[]): string {
  let pdf = '%PDF-1.7\n'

  const offsets: number[] = []
  objects.forEach((body, index) => {
    offsets.push(pdf.length)
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`
  })

  const startxref = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n`
  pdf += '0000000000 65535 f \n'
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`
  pdf += `startxref\n${startxref}\n%%EOF\n`

  return pdf
}

/**
 * Build a valid one-page PDF that `pdfjs-dist` can parse and render.
 *
 * The page is deliberately wide and `text` is expected to be short: pdfjs splits
 * overflowing text into several text-layer spans, so callers that assert on the
 * drawn text need it to fit on one line.
 *
 * @param text - text drawn on the page, used to tell fixture documents apart
 */
export function createSinglePagePdf(text: string): Uint8Array<ArrayBuffer> {
  const content = `BT /F1 24 Tf 16 96 Td (${text}) Tj ET`

  const objects: PdfObject[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 420 200] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]

  return new TextEncoder().encode(buildCrossReferencedPdf(objects))
}
