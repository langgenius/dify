import { createExternalAgentCapabilities } from '@/test/console/external-agents'
import { getTestFileRules, localFileMime, suggestedLinkFile } from '../file-limits'

it('intersects normalized MIME aliases and wildcard coverage while using the effective deployment limits', () => {
  const capabilities = createExternalAgentCapabilities({
    limits: {
      files: { max_files: 2, max_document_bytes: 100, max_image_bytes: 50, max_total_bytes: 150 },
    },
  })
  expect(getTestFileRules(capabilities, ['TEXT/*; charset=utf-8', 'application/x-pdf'])).toEqual({
    modes: ['application/pdf', 'text/plain', 'text/markdown'],
    maxFiles: 2,
    maxDocumentBytes: 100,
    maxImageBytes: 50,
    maxTotalBytes: 150,
  })
  expect(
    getTestFileRules({ ...capabilities, input_file_modes: ['image/jpg'] }, ['image/*'])?.modes,
  ).toEqual(['image/jpeg'])
})

it('does not substitute outer defaults when the effective files limits are absent', () => {
  expect(
    getTestFileRules(
      createExternalAgentCapabilities({ limits: { max_files: 5, max_document_bytes: 15_000_000 } }),
      ['*/*'],
    ),
  ).toBeNull()
})

it('prefills only known extensions from the path and leaves opaque file MIME selection explicit', () => {
  expect(suggestedLinkFile('https://files.example.test/Contract%20terms.PDF?download=1')).toEqual({
    name: 'Contract terms.PDF',
    mime: 'application/pdf',
  })
  expect(suggestedLinkFile('https://files.example.test/download?id=report.pdf')).toEqual({
    name: 'download',
    mime: '',
  })
})

it('uses the local file extension when the browser does not report a MIME type', () => {
  expect(localFileMime(new File(['text'], 'notes.MD'))).toBe('text/markdown')
  expect(localFileMime(new File(['text'], 'notes.md', { type: 'text/x-markdown' }))).toBe(
    'text/markdown',
  )
})
