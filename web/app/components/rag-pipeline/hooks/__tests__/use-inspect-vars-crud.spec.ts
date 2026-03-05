import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useInspectVarsCrud } from '../use-inspect-vars-crud'

// Mock return value for useInspectVarsCrudCommon
const mockApis = {
  hasNodeInspectVars: vi.fn(),
  hasSetInspectVar: vi.fn(),
  fetchInspectVarValue: vi.fn(),
  editInspectVarValue: vi.fn(),
  renameInspectVarName: vi.fn(),
  appendNodeInspectVars: vi.fn(),
  deleteInspectVar: vi.fn(),
  deleteNodeInspectorVars: vi.fn(),
  deleteAllInspectorVars: vi.fn(),
  isInspectVarEdited: vi.fn(),
  resetToLastRunVar: vi.fn(),
  invalidateSysVarValues: vi.fn(),
  resetConversationVar: vi.fn(),
  invalidateConversationVarValues: vi.fn(),
}

const mockUseInspectVarsCrudCommon = vi.fn(() => mockApis)
vi.mock('../../../workflow/hooks/use-inspect-vars-crud-common', () => ({
  useInspectVarsCrudCommon: (...args: Parameters<typeof mockUseInspectVarsCrudCommon>) => mockUseInspectVarsCrudCommon(...args),
}))

const mockConfigsMap = {
  flowId: 'pipeline-123',
  flowType: 'rag_pipeline',
  fileSettings: {
    image: { enabled: false },
    fileUploadConfig: {},
  },
}

vi.mock('../use-configs-map', () => ({
  useConfigsMap: () => mockConfigsMap,
}))

describe('useInspectVarsCrud', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Verify the hook composes useConfigsMap with useInspectVarsCrudCommon
  describe('Composition', () => {
    it('should pass configsMap to useInspectVarsCrudCommon', () => {
      renderHook(() => useInspectVarsCrud())

      expect(mockUseInspectVarsCrudCommon).toHaveBeenCalledWith(
        expect.objectContaining({
          flowId: 'pipeline-123',
          flowType: 'rag_pipeline',
        }),
      )
    })

    it('should return all APIs from useInspectVarsCrudCommon', () => {
      const { result } = renderHook(() => useInspectVarsCrud())

      expect(result.current.hasNodeInspectVars).toBe(mockApis.hasNodeInspectVars)
      expect(result.current.fetchInspectVarValue).toBe(mockApis.fetchInspectVarValue)
      expect(result.current.editInspectVarValue).toBe(mockApis.editInspectVarValue)
      expect(result.current.deleteInspectVar).toBe(mockApis.deleteInspectVar)
      expect(result.current.deleteAllInspectorVars).toBe(mockApis.deleteAllInspectorVars)
      expect(result.current.resetToLastRunVar).toBe(mockApis.resetToLastRunVar)
      expect(result.current.resetConversationVar).toBe(mockApis.resetConversationVar)
    })
  })

  // Verify the hook spreads all returned properties
  describe('API Surface', () => {
    it('should expose all expected API methods', () => {
      const { result } = renderHook(() => useInspectVarsCrud())

      const expectedKeys = [
        'hasNodeInspectVars',
        'hasSetInspectVar',
        'fetchInspectVarValue',
        'editInspectVarValue',
        'renameInspectVarName',
        'appendNodeInspectVars',
        'deleteInspectVar',
        'deleteNodeInspectorVars',
        'deleteAllInspectorVars',
        'isInspectVarEdited',
        'resetToLastRunVar',
        'invalidateSysVarValues',
        'resetConversationVar',
        'invalidateConversationVarValues',
      ]

      for (const key of expectedKeys)
        expect(result.current).toHaveProperty(key)
    })
  })
})
