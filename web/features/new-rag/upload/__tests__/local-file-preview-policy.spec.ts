import { canPreviewLocalFile } from '../local-file-preview-policy'

it('offers component previews for browser-readable upload formats', () => {
  const previewable = ['csv', 'htm', 'html', 'json', 'jsonl', 'md', 'pdf', 'text', 'txt']
  const parserRequired = ['doc', 'docx', 'epub', 'ppt', 'pptx', 'rtf', 'xls', 'xlsx']
  expect(
    previewable.every((extension) =>
      canPreviewLocalFile(new File(['content'], `document.${extension}`)),
    ),
  ).toBe(true)
  expect(
    parserRequired.every(
      (extension) => !canPreviewLocalFile(new File(['content'], `document.${extension}`)),
    ),
  ).toBe(true)
})
