import type { SkillFileResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import { describe, expect, it } from 'vite-plus/test'
import {
  buildUploadReviewItems,
  createAvailableUploadPath,
  createSuggestedUploadPath,
  resolveUploadReviewItem,
} from '../upload-workflow'

const existingFile = (path: string): SkillFileResponse => ({
  content: null,
  hash: path,
  id: path,
  kind: 'file',
  mime_type: 'text/markdown',
  path,
  size: 1,
  storage: 'text',
  tool_file_id: null,
})

describe('Skill upload workflow', () => {
  it('generates the Figma keep-both suffix after existing paths', () => {
    expect(createAvailableUploadPath('report.pdf', ['report.pdf'])).toBe('report-2.pdf')
    expect(
      createAvailableUploadPath('references/report.pdf', [
        'references/report.pdf',
        'references/report-2.pdf',
      ]),
    ).toBe('references/report-3.pdf')
  })

  it('normalizes an invalid filename and avoids another collision', () => {
    expect(createSuggestedUploadPath('my notes!.md', [])).toBe('my-notes.md')
    expect(createSuggestedUploadPath('my notes!.md', ['my-notes.md'])).toBe('my-notes-2.md')
  })

  it('maps backend check errors into ready, decision, and skipped states', () => {
    const report = new File(['pdf'], 'report.pdf', { type: 'application/pdf' })
    const notes = new File(['notes'], 'my notes!.md', { type: 'text/markdown' })
    const unsupported = new File(['data'], 'report.abcd')
    const items = buildUploadReviewItems({
      checks: {
        'my notes!.md': {
          errors: [{ code: 'invalid_filename', message: 'filename is invalid' }],
          extension: '.md',
          filename: 'my notes!.md',
          mime_type: 'text/markdown',
          path: 'my notes!.md',
          size: notes.size,
        },
        'report.abcd': {
          errors: [{ code: 'invalid_file_extension', message: 'extension is invalid' }],
          extension: '.abcd',
          filename: 'report.abcd',
          mime_type: 'application/octet-stream',
          path: 'report.abcd',
          size: unsupported.size,
        },
        'report.pdf': {
          errors: [{ code: 'file_already_exists', message: 'file already exists' }],
          extension: '.pdf',
          filename: 'report.pdf',
          mime_type: 'application/pdf',
          path: 'report.pdf',
          size: report.size,
        },
      },
      existingFiles: [existingFile('report.pdf')],
      files: [report, notes, unsupported],
      itemIds: ['report', 'notes', 'unsupported'],
      paths: ['report.pdf', 'my notes!.md', 'report.abcd'],
    })

    expect(items.map((item) => item.kind)).toEqual(['conflict', 'invalid-name', 'skipped'])
    expect(items[0]?.suggestedPath).toBe('report-2.pdf')
    expect(items[1]?.suggestedPath).toBe('my-notes.md')
    expect(items[2]?.decision).toBe('skip')
    expect(resolveUploadReviewItem(items[0]!, 'keep-both').resolvedPath).toBe('report-2.pdf')
    expect(resolveUploadReviewItem(items[1]!, 'use-suggestion').resolvedPath).toBe('my-notes.md')
  })
})
