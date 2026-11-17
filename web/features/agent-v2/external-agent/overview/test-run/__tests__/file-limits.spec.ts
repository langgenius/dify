import { createExternalAgentCapabilities } from '@/test/console/external-agents'
import { getTestFileRules, localFileMime, suggestedLinkFile } from '../file-limits'

it('intersects normalized MIME aliases and wildcard coverage while using the effective deployment limits', () => {
  const capabilities = createExternalAgentCapabilities({
    limits: {
      files: { max_files: 2, max_document_bytes: 100, max_image_bytes: 50, max_total_bytes: 150 },
    },
  })
  expect(getTestFileRules(capabilities, ['TEXT/*; charset=utf-8', 'application/x-pdf'])).toEqual({
    modes: ['application/pdf', 'text/markdown', 'text/plain'],
    fileTypes: [
      { media_type: 'application/pdf', extensions: ['.pdf'] },
      { media_type: 'text/markdown', extensions: ['.md', '.markdown'] },
      { media_type: 'text/plain', extensions: ['.txt'] },
    ],
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
  const { input_file_types: fileTypes } = createExternalAgentCapabilities()
  expect(
    suggestedLinkFile('https://files.example.test/Contract%20terms.PDF?download=1', fileTypes),
  ).toEqual({
    name: 'Contract terms.PDF',
    mime: 'application/pdf',
  })
  expect(suggestedLinkFile('https://files.example.test/download?id=report.pdf', fileTypes)).toEqual(
    {
      name: 'download',
      mime: '',
    },
  )
})

it('uses the local file extension when the browser does not report a MIME type', () => {
  const { input_file_types: fileTypes } = createExternalAgentCapabilities()
  expect(localFileMime(new File(['text'], 'notes.MARKDOWN'), fileTypes)).toBe('text/markdown')
  expect(
    localFileMime(new File(['text'], 'notes.md', { type: 'text/x-markdown' }), fileTypes),
  ).toBe('text/markdown')
  expect(suggestedLinkFile('https://files.example.test/notes.markdown', fileTypes).mime).toBe(
    'text/markdown',
  )
  const pdfOnly = fileTypes.filter((type) => type.media_type === 'application/pdf')
  expect(localFileMime(new File(['text'], 'notes.md'), pdfOnly)).toBe('')
})
