import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vite-plus/test'
import { consoleQuery } from '@/service/client'
import {
  createUploadItemId,
  deriveSkillDetailFromDraftFiles,
  getErrorCode,
  getErrorDetailNumber,
  getErrorDetailString,
  getUploadFileName,
  getUploadPath,
  isEditableKeyboardTarget,
  joinSkillPath,
  setSkillDetailCache,
} from '../shared'

describe('skill detail shared utilities', () => {
  it('reads error codes and details from supported error shapes', () => {
    expect(getErrorCode({ code: 'direct' })).toBe('direct')
    expect(getErrorCode({ data: { code: 'data' } })).toBe('data')
    expect(getErrorCode({ body: { code: 'body' } })).toBe('body')
    expect(getErrorCode('error')).toBeUndefined()

    expect(
      getErrorDetailNumber({ details: { current_updated_at: 12 } }, 'current_updated_at'),
    ).toBe(12)
    expect(
      getErrorDetailNumber({ data: { details: { current_updated_at: 13 } } }, 'current_updated_at'),
    ).toBe(13)
    expect(
      getErrorDetailString(
        { body: { details: { current_file_hash: 'hash' } } },
        'current_file_hash',
      ),
    ).toBe('hash')
    expect(
      getErrorDetailString({ details: { current_file_hash: 1 } }, 'current_file_hash'),
    ).toBeUndefined()
  })

  it('normalizes upload paths and names', () => {
    const plainFile = new File(['guide'], 'guide.md', { type: 'text/markdown' })
    const nestedFile = new File(['guide'], 'guide.md', { type: 'text/markdown' })
    Object.defineProperty(nestedFile, 'webkitRelativePath', {
      configurable: true,
      value: 'folder/guide.md',
    })

    expect(joinSkillPath(undefined, '/guide.md')).toBe('guide.md')
    expect(joinSkillPath('/references/', '/guide.md')).toBe('references/guide.md')
    expect(getUploadPath(plainFile, 'references')).toBe('references/guide.md')
    expect(getUploadPath(nestedFile, 'references')).toBe('references/folder/guide.md')
    expect(getUploadFileName(nestedFile)).toBe('folder/guide.md')
  })

  it('detects editable keyboard targets', () => {
    const input = document.createElement('input')
    const textarea = document.createElement('textarea')
    const select = document.createElement('select')
    const editor = document.createElement('div')
    editor.contentEditable = 'true'
    const nested = document.createElement('span')
    editor.appendChild(nested)
    const plain = document.createElement('button')

    expect(isEditableKeyboardTarget(input)).toBe(true)
    expect(isEditableKeyboardTarget(textarea)).toBe(true)
    expect(isEditableKeyboardTarget(select)).toBe(true)
    expect(isEditableKeyboardTarget(editor)).toBe(true)
    expect(isEditableKeyboardTarget(nested)).toBe(true)
    expect(isEditableKeyboardTarget(plain)).toBe(false)
    expect(isEditableKeyboardTarget(null)).toBe(false)
  })

  it('falls back to a deterministic upload item id when randomUUID is unavailable', () => {
    const originalCrypto = globalThis.crypto
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: {},
    })
    try {
      const file = new File(['guide'], 'guide.md', { type: 'text/markdown' })
      vi.spyOn(file, 'lastModified', 'get').mockReturnValue(123)

      expect(createUploadItemId(file, 2)).toBe('guide.md-5-123-2')
    } finally {
      Object.defineProperty(globalThis, 'crypto', {
        configurable: true,
        value: originalCrypto,
      })
    }
  })

  it('does not derive entity name or display name from SKILL.md draft content', () => {
    expect(
      deriveSkillDetailFromDraftFiles({
        description: 'Entity description',
        display_name: 'Entity Display Name',
        files: [
          {
            content:
              '---\nname: skill-md-name\ndescription: Skill.md description\nmetadata:\n  display-name: Skill.md Display Name\n---\n# Body\n',
            kind: 'file',
            mime_type: 'text/markdown',
            path: 'SKILL.md',
            storage: 'text',
          },
        ],
        latest_published_version_id: null,
        name: 'entity-name',
        name_manually_edited: false,
      } as Parameters<typeof deriveSkillDetailFromDraftFiles>[0]),
    ).toMatchObject({
      description: 'Skill.md description',
      display_name: 'Entity Display Name',
      name: 'entity-name',
    })
  })

  it('derives untitled builder draft name and display name from SKILL.md content', () => {
    expect(
      deriveSkillDetailFromDraftFiles({
        description: 'Entity description',
        display_name: 'Untitled skill',
        files: [
          {
            content:
              '---\nname: untitled-skill-12345678\ndescription: Skill.md description\nmetadata:\n  display-name: Untitled skill\n---\n# Customer Issue Triage\n',
            kind: 'file',
            mime_type: 'text/markdown',
            path: 'SKILL.md',
            storage: 'text',
          },
        ],
        latest_published_version_id: null,
        name: 'untitled-skill-12345678',
        name_manually_edited: false,
      } as Parameters<typeof deriveSkillDetailFromDraftFiles>[0]),
    ).toMatchObject({
      description: 'Skill.md description',
      display_name: 'Customer Issue Triage',
      name: 'customer-issue-triage',
    })
  })

  it('updates cached skill list entries when detail cache changes', () => {
    const queryClient = new QueryClient()
    const detail = {
      id: 'skill-1',
      name: 'customer-issue-triage',
      display_name: 'Customer Issue Triage',
      icon: '📄',
      description: 'Classify customer issues.',
      tags: [],
      name_manually_edited: false,
      visibility: 'workspace',
      latest_published_version_id: null,
      latest_published_version_number: null,
      latest_published_at: null,
      reference_count: 0,
      created_by: 'user-1',
      created_by_name: 'Fate',
      updated_by: 'user-1',
      updated_by_name: 'Fate',
      created_at: 1,
      updated_at: 2,
      files: [],
    } as Parameters<typeof setSkillDetailCache>[2]
    const infiniteKey = consoleQuery.workspaces.current.skills.get.key({ type: 'infinite' })
    queryClient.setQueryData(infiniteKey, {
      pageParams: [1],
      pages: [
        {
          data: [
            {
              ...detail,
              name: 'untitled-skill-12345678',
              display_name: 'Untitled skill',
              latest_published_version_number: null,
            },
          ],
          has_more: false,
          limit: 20,
          page: 1,
          total: 1,
        },
      ],
    })

    setSkillDetailCache(queryClient, detail.id, detail)

    expect(queryClient.getQueryData(infiniteKey)).toMatchObject({
      pages: [
        {
          data: [
            {
              display_name: 'Customer Issue Triage',
              name: 'customer-issue-triage',
            },
          ],
        },
      ],
    })
  })
})
