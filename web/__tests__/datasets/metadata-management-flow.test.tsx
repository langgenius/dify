/**
 * Integration Test: Metadata Management Flow
 *
 * Tests the cross-module composition of metadata name validation, type constraints,
 * and duplicate detection across the metadata management hooks.
 *
 * The unit-level use-check-metadata-name.spec.ts tests the validation hook alone.
 * This integration test verifies:
 *   - Name validation combined with existing metadata list (duplicate detection)
 *   - Metadata type enum constraints matching expected data model
 *   - Full add/rename workflow: validate name → check duplicates → allow or reject
 *   - Name uniqueness logic: existing metadata keeps its own name, cannot take another's
 */

import type { MetadataItemWithValueLength } from '@/app/components/datasets/metadata/types'
import { renderHook } from '@testing-library/react'
import { DataType } from '@/app/components/datasets/metadata/types'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

const { default: useCheckMetadataName } = await import(
  '@/app/components/datasets/metadata/hooks/use-check-metadata-name',
)

// --- Factory functions ---

const createMetadataItem = (
  id: string,
  name: string,
  type = DataType.string,
  count = 0,
): MetadataItemWithValueLength => ({
  id,
  name,
  type,
  count,
})

const createMetadataList = (): MetadataItemWithValueLength[] => [
  createMetadataItem('meta-1', 'author', DataType.string, 5),
  createMetadataItem('meta-2', 'created_date', DataType.time, 10),
  createMetadataItem('meta-3', 'page_count', DataType.number, 3),
  createMetadataItem('meta-4', 'source_url', DataType.string, 8),
  createMetadataItem('meta-5', 'version', DataType.number, 2),
]

describe('Metadata Management Flow - Cross-Module Validation Composition', () => {
  describe('Name Validation Flow: Format Rules', () => {
    it('should accept valid lowercase names with underscores', () => {
      const { result } = renderHook(() => useCheckMetadataName())

      expect(result.current.checkName('valid_name').errorMsg).toBe('')
      expect(result.current.checkName('author').errorMsg).toBe('')
      expect(result.current.checkName('page_count').errorMsg).toBe('')
      expect(result.current.checkName('v2_field').errorMsg).toBe('')
    })

    it('should reject empty names', () => {
      const { result } = renderHook(() => useCheckMetadataName())

      expect(result.current.checkName('').errorMsg).toBeTruthy()
    })

    it('should reject names with invalid characters', () => {
      const { result } = renderHook(() => useCheckMetadataName())

      expect(result.current.checkName('Author').errorMsg).toBeTruthy()
      expect(result.current.checkName('my-field').errorMsg).toBeTruthy()
      expect(result.current.checkName('field name').errorMsg).toBeTruthy()
      expect(result.current.checkName('1field').errorMsg).toBeTruthy()
      expect(result.current.checkName('_private').errorMsg).toBeTruthy()
    })

    it('should reject names exceeding 255 characters', () => {
      const { result } = renderHook(() => useCheckMetadataName())

      const longName = 'a'.repeat(256)
      expect(result.current.checkName(longName).errorMsg).toBeTruthy()

      const maxName = 'a'.repeat(255)
      expect(result.current.checkName(maxName).errorMsg).toBe('')
    })
  })

  describe('Metadata Type Constraints: Enum Values Match Expected Set', () => {
    it('should define exactly three data types', () => {
      const typeValues = Object.values(DataType)
      expect(typeValues).toHaveLength(3)
    })

    it('should include string, number, and time types', () => {
      expect(DataType.string).toBe('string')
      expect(DataType.number).toBe('number')
      expect(DataType.time).toBe('time')
    })

    it('should use consistent types in metadata items', () => {
      const metadataList = createMetadataList()

      const stringItems = metadataList.filter(m => m.type === DataType.string)
      const numberItems = metadataList.filter(m => m.type === DataType.number)
      const timeItems = metadataList.filter(m => m.type === DataType.time)

      expect(stringItems).toHaveLength(2)
      expect(numberItems).toHaveLength(2)
      expect(timeItems).toHaveLength(1)
    })

    it('should enforce type-safe metadata item construction', () => {
      const item = createMetadataItem('test-1', 'test_field', DataType.number, 0)

      expect(item.id).toBe('test-1')
      expect(item.name).toBe('test_field')
      expect(item.type).toBe(DataType.number)
      expect(item.count).toBe(0)
    })
  })

  describe('Duplicate Name Detection: Add Metadata → Check Name → Detect Duplicates', () => {
    it('should detect duplicate names against an existing metadata list', () => {
      const { result } = renderHook(() => useCheckMetadataName())
      const existingMetadata = createMetadataList()

      const checkDuplicate = (newName: string): boolean => {
        const formatCheck = result.current.checkName(newName)
        if (formatCheck.errorMsg)
          return false
        return existingMetadata.some(m => m.name === newName)
      }

      expect(checkDuplicate('author')).toBe(true)
      expect(checkDuplicate('created_date')).toBe(true)
      expect(checkDuplicate('page_count')).toBe(true)
    })

    it('should allow names that do not conflict with existing metadata', () => {
      const { result } = renderHook(() => useCheckMetadataName())
      const existingMetadata = createMetadataList()

      const isNameAvailable = (newName: string): boolean => {
        const formatCheck = result.current.checkName(newName)
        if (formatCheck.errorMsg)
          return false
        return !existingMetadata.some(m => m.name === newName)
      }

      expect(isNameAvailable('category')).toBe(true)
      expect(isNameAvailable('file_size')).toBe(true)
      expect(isNameAvailable('language')).toBe(true)
    })

    it('should reject names that fail format validation before duplicate check', () => {
      const { result } = renderHook(() => useCheckMetadataName())

      const validateAndCheckDuplicate = (newName: string): { valid: boolean, reason: string } => {
        const formatCheck = result.current.checkName(newName)
        if (formatCheck.errorMsg)
          return { valid: false, reason: 'format' }
        return { valid: true, reason: '' }
      }

      expect(validateAndCheckDuplicate('Author').reason).toBe('format')
      expect(validateAndCheckDuplicate('').reason).toBe('format')
      expect(validateAndCheckDuplicate('valid_name').valid).toBe(true)
    })
  })

  describe('Name Uniqueness Across Edits: Rename Workflow', () => {
    it('should allow an existing metadata item to keep its own name', () => {
      const { result } = renderHook(() => useCheckMetadataName())
      const existingMetadata = createMetadataList()

      const isRenameValid = (itemId: string, newName: string): boolean => {
        const formatCheck = result.current.checkName(newName)
        if (formatCheck.errorMsg)
          return false
        // Allow keeping the same name (skip self in duplicate check)
        return !existingMetadata.some(m => m.name === newName && m.id !== itemId)
      }

      // Author keeping its own name should be valid
      expect(isRenameValid('meta-1', 'author')).toBe(true)
      // page_count keeping its own name should be valid
      expect(isRenameValid('meta-3', 'page_count')).toBe(true)
    })

    it('should reject renaming to another existing metadata name', () => {
      const { result } = renderHook(() => useCheckMetadataName())
      const existingMetadata = createMetadataList()

      const isRenameValid = (itemId: string, newName: string): boolean => {
        const formatCheck = result.current.checkName(newName)
        if (formatCheck.errorMsg)
          return false
        return !existingMetadata.some(m => m.name === newName && m.id !== itemId)
      }

      // Author trying to rename to "page_count" (taken by meta-3)
      expect(isRenameValid('meta-1', 'page_count')).toBe(false)
      // version trying to rename to "source_url" (taken by meta-4)
      expect(isRenameValid('meta-5', 'source_url')).toBe(false)
    })

    it('should allow renaming to a completely new valid name', () => {
      const { result } = renderHook(() => useCheckMetadataName())
      const existingMetadata = createMetadataList()

      const isRenameValid = (itemId: string, newName: string): boolean => {
        const formatCheck = result.current.checkName(newName)
        if (formatCheck.errorMsg)
          return false
        return !existingMetadata.some(m => m.name === newName && m.id !== itemId)
      }

      expect(isRenameValid('meta-1', 'document_author')).toBe(true)
      expect(isRenameValid('meta-2', 'publish_date')).toBe(true)
      expect(isRenameValid('meta-3', 'total_pages')).toBe(true)
    })

    it('should reject renaming with an invalid format even if name is unique', () => {
      const { result } = renderHook(() => useCheckMetadataName())
      const existingMetadata = createMetadataList()

      const isRenameValid = (itemId: string, newName: string): boolean => {
        const formatCheck = result.current.checkName(newName)
        if (formatCheck.errorMsg)
          return false
        return !existingMetadata.some(m => m.name === newName && m.id !== itemId)
      }

      expect(isRenameValid('meta-1', 'New Author')).toBe(false)
      expect(isRenameValid('meta-2', '2024_date')).toBe(false)
      expect(isRenameValid('meta-3', '')).toBe(false)
    })
  })

  describe('Full Metadata Management Workflow', () => {
    it('should support a complete add-validate-check-duplicate cycle', () => {
      const { result } = renderHook(() => useCheckMetadataName())
      const existingMetadata = createMetadataList()

      const addMetadataField = (
        name: string,
        type: DataType,
      ): { success: boolean, error?: string } => {
        const formatCheck = result.current.checkName(name)
        if (formatCheck.errorMsg)
          return { success: false, error: 'invalid_format' }

        if (existingMetadata.some(m => m.name === name))
          return { success: false, error: 'duplicate_name' }

        existingMetadata.push(createMetadataItem(`meta-${existingMetadata.length + 1}`, name, type))
        return { success: true }
      }

      // Add a valid new field
      const result1 = addMetadataField('department', DataType.string)
      expect(result1.success).toBe(true)
      expect(existingMetadata).toHaveLength(6)

      // Try to add a duplicate
      const result2 = addMetadataField('author', DataType.string)
      expect(result2.success).toBe(false)
      expect(result2.error).toBe('duplicate_name')
      expect(existingMetadata).toHaveLength(6)

      // Try to add an invalid name
      const result3 = addMetadataField('Invalid Name', DataType.string)
      expect(result3.success).toBe(false)
      expect(result3.error).toBe('invalid_format')
      expect(existingMetadata).toHaveLength(6)

      // Add another valid field
      const result4 = addMetadataField('priority_level', DataType.number)
      expect(result4.success).toBe(true)
      expect(existingMetadata).toHaveLength(7)
    })

    it('should support a complete rename workflow with validation chain', () => {
      const { result } = renderHook(() => useCheckMetadataName())
      const existingMetadata = createMetadataList()

      const renameMetadataField = (
        itemId: string,
        newName: string,
      ): { success: boolean, error?: string } => {
        const formatCheck = result.current.checkName(newName)
        if (formatCheck.errorMsg)
          return { success: false, error: 'invalid_format' }

        if (existingMetadata.some(m => m.name === newName && m.id !== itemId))
          return { success: false, error: 'duplicate_name' }

        const item = existingMetadata.find(m => m.id === itemId)
        if (!item)
          return { success: false, error: 'not_found' }

        // Simulate the rename in-place
        const index = existingMetadata.indexOf(item)
        existingMetadata[index] = { ...item, name: newName }
        return { success: true }
      }

      // Rename author to document_author
      expect(renameMetadataField('meta-1', 'document_author').success).toBe(true)
      expect(existingMetadata.find(m => m.id === 'meta-1')?.name).toBe('document_author')

      // Try renaming created_date to page_count (already taken)
      expect(renameMetadataField('meta-2', 'page_count').error).toBe('duplicate_name')

      // Rename to invalid format
      expect(renameMetadataField('meta-3', 'Page Count').error).toBe('invalid_format')

      // Rename non-existent item
      expect(renameMetadataField('meta-999', 'something').error).toBe('not_found')
    })

    it('should maintain validation consistency across multiple operations', () => {
      const { result } = renderHook(() => useCheckMetadataName())

      // Validate the same name multiple times for consistency
      const name = 'consistent_field'
      const results = Array.from({ length: 5 }, () => result.current.checkName(name))

      expect(results.every(r => r.errorMsg === '')).toBe(true)

      // Validate an invalid name multiple times
      const invalidResults = Array.from({ length: 5 }, () => result.current.checkName('Invalid'))
      expect(invalidResults.every(r => r.errorMsg !== '')).toBe(true)
    })
  })
})
