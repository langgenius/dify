import type { PreProcessingRule, Rules } from '@/models/datasets'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ChunkingMode, ProcessMode } from '@/models/datasets'
import {
  DEFAULT_MAXIMUM_CHUNK_LENGTH,
  DEFAULT_OVERLAP,
  DEFAULT_SEGMENT_IDENTIFIER,
  defaultParentChildConfig,
  useSegmentationState,
} from '../use-segmentation-state'

describe('useSegmentationState', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // --- Default state ---
  describe('default state', () => {
    it('should initialize with default values', () => {
      const { result } = renderHook(() => useSegmentationState())

      expect(result.current.segmentationType).toBe(ProcessMode.general)
      expect(result.current.segmentIdentifier).toBe(DEFAULT_SEGMENT_IDENTIFIER)
      expect(result.current.maxChunkLength).toBe(DEFAULT_MAXIMUM_CHUNK_LENGTH)
      expect(result.current.overlap).toBe(DEFAULT_OVERLAP)
      expect(result.current.rules).toEqual([])
      expect(result.current.parentChildConfig).toEqual(defaultParentChildConfig)
    })

    it('should accept initial segmentation type', () => {
      const { result } = renderHook(() =>
        useSegmentationState({ initialSegmentationType: ProcessMode.parentChild }),
      )
      expect(result.current.segmentationType).toBe(ProcessMode.parentChild)
    })

    it('should accept initial summary index setting', () => {
      const setting = { enable: true }
      const { result } = renderHook(() =>
        useSegmentationState({ initialSummaryIndexSetting: setting }),
      )
      expect(result.current.summaryIndexSetting).toEqual(setting)
    })
  })

  // --- Setters ---
  describe('setters', () => {
    it('should update segmentation type', () => {
      const { result } = renderHook(() => useSegmentationState())

      act(() => {
        result.current.setSegmentationType(ProcessMode.parentChild)
      })
      expect(result.current.segmentationType).toBe(ProcessMode.parentChild)
    })

    it('should update max chunk length', () => {
      const { result } = renderHook(() => useSegmentationState())

      act(() => {
        result.current.setMaxChunkLength(2048)
      })
      expect(result.current.maxChunkLength).toBe(2048)
    })

    it('should update overlap', () => {
      const { result } = renderHook(() => useSegmentationState())

      act(() => {
        result.current.setOverlap(100)
      })
      expect(result.current.overlap).toBe(100)
    })

    it('should update rules', () => {
      const newRules: PreProcessingRule[] = [
        { id: 'remove_extra_spaces', enabled: true },
        { id: 'remove_urls_emails', enabled: false },
      ]
      const { result } = renderHook(() => useSegmentationState())

      act(() => {
        result.current.setRules(newRules)
      })
      expect(result.current.rules).toEqual(newRules)
    })
  })

  // --- Segment identifier with escaping ---
  describe('setSegmentIdentifier', () => {
    it('should escape the value when setting', () => {
      const { result } = renderHook(() => useSegmentationState())

      act(() => {
        result.current.setSegmentIdentifier('\n\n')
      })
      expect(result.current.segmentIdentifier).toBe('\\n\\n')
    })

    it('should reset to default when empty and canEmpty is false', () => {
      const { result } = renderHook(() => useSegmentationState())

      act(() => {
        result.current.setSegmentIdentifier('')
      })
      expect(result.current.segmentIdentifier).toBe(DEFAULT_SEGMENT_IDENTIFIER)
    })

    it('should allow empty value when canEmpty is true', () => {
      const { result } = renderHook(() => useSegmentationState())

      act(() => {
        result.current.setSegmentIdentifier('', true)
      })
      expect(result.current.segmentIdentifier).toBe('')
    })
  })

  // --- Toggle rule ---
  describe('toggleRule', () => {
    it('should toggle a rule enabled state', () => {
      const { result } = renderHook(() => useSegmentationState())
      const rules: PreProcessingRule[] = [
        { id: 'remove_extra_spaces', enabled: true },
        { id: 'remove_urls_emails', enabled: false },
      ]

      act(() => {
        result.current.setRules(rules)
      })
      act(() => {
        result.current.toggleRule('remove_extra_spaces')
      })

      expect(result.current.rules[0].enabled).toBe(false)
      expect(result.current.rules[1].enabled).toBe(false)
    })

    it('should toggle second rule without affecting first', () => {
      const { result } = renderHook(() => useSegmentationState())
      const rules: PreProcessingRule[] = [
        { id: 'remove_extra_spaces', enabled: true },
        { id: 'remove_urls_emails', enabled: false },
      ]

      act(() => {
        result.current.setRules(rules)
      })
      act(() => {
        result.current.toggleRule('remove_urls_emails')
      })

      expect(result.current.rules[0].enabled).toBe(true)
      expect(result.current.rules[1].enabled).toBe(true)
    })
  })

  // --- Parent-child config ---
  describe('parent-child config', () => {
    it('should update parent delimiter with escaping', () => {
      const { result } = renderHook(() => useSegmentationState())

      act(() => {
        result.current.updateParentConfig('delimiter', '\n')
      })
      expect(result.current.parentChildConfig.parent.delimiter).toBe('\\n')
    })

    it('should update parent maxLength', () => {
      const { result } = renderHook(() => useSegmentationState())

      act(() => {
        result.current.updateParentConfig('maxLength', 2048)
      })
      expect(result.current.parentChildConfig.parent.maxLength).toBe(2048)
    })

    it('should update child delimiter with escaping', () => {
      const { result } = renderHook(() => useSegmentationState())

      act(() => {
        result.current.updateChildConfig('delimiter', '\t')
      })
      expect(result.current.parentChildConfig.child.delimiter).toBe('\\t')
    })

    it('should update child maxLength', () => {
      const { result } = renderHook(() => useSegmentationState())

      act(() => {
        result.current.updateChildConfig('maxLength', 256)
      })
      expect(result.current.parentChildConfig.child.maxLength).toBe(256)
    })

    it('should set empty delimiter when value is empty', () => {
      const { result } = renderHook(() => useSegmentationState())

      act(() => {
        result.current.updateParentConfig('delimiter', '')
      })
      expect(result.current.parentChildConfig.parent.delimiter).toBe('')
    })

    it('should set chunk for context mode', () => {
      const { result } = renderHook(() => useSegmentationState())

      act(() => {
        result.current.setChunkForContext('full-doc')
      })
      expect(result.current.parentChildConfig.chunkForContext).toBe('full-doc')
    })
  })

  // --- Reset to defaults ---
  describe('resetToDefaults', () => {
    it('should reset to default config when defaults are set', () => {
      const { result } = renderHook(() => useSegmentationState())
      const defaultRules: Rules = {
        pre_processing_rules: [{ id: 'remove_extra_spaces', enabled: true }],
        segmentation: {
          separator: '---',
          max_tokens: 500,
          chunk_overlap: 25,
        },
        parent_mode: 'paragraph',
        subchunk_segmentation: {
          separator: '\n',
          max_tokens: 200,
        },
      }

      act(() => {
        result.current.setDefaultConfig(defaultRules)
      })
      // Change values
      act(() => {
        result.current.setMaxChunkLength(2048)
        result.current.setOverlap(200)
      })
      act(() => {
        result.current.resetToDefaults()
      })

      expect(result.current.maxChunkLength).toBe(500)
      expect(result.current.overlap).toBe(25)
      expect(result.current.parentChildConfig).toEqual(defaultParentChildConfig)
    })

    it('should reset parent-child config even without default config', () => {
      const { result } = renderHook(() => useSegmentationState())

      act(() => {
        result.current.updateParentConfig('maxLength', 9999)
      })
      act(() => {
        result.current.resetToDefaults()
      })

      expect(result.current.parentChildConfig).toEqual(defaultParentChildConfig)
    })
  })

  // --- applyConfigFromRules ---
  describe('applyConfigFromRules', () => {
    it('should apply general config from rules', () => {
      const { result } = renderHook(() => useSegmentationState())
      const rulesConfig: Rules = {
        pre_processing_rules: [{ id: 'remove_extra_spaces', enabled: true }],
        segmentation: {
          separator: '|||',
          max_tokens: 800,
          chunk_overlap: 30,
        },
        parent_mode: 'paragraph',
        subchunk_segmentation: {
          separator: '\n',
          max_tokens: 200,
        },
      }

      act(() => {
        result.current.applyConfigFromRules(rulesConfig, false)
      })

      expect(result.current.maxChunkLength).toBe(800)
      expect(result.current.overlap).toBe(30)
      expect(result.current.rules).toEqual(rulesConfig.pre_processing_rules)
    })

    it('should apply hierarchical config from rules', () => {
      const { result } = renderHook(() => useSegmentationState())
      const rulesConfig: Rules = {
        pre_processing_rules: [],
        segmentation: {
          separator: '\n\n',
          max_tokens: 1024,
          chunk_overlap: 50,
        },
        parent_mode: 'full-doc',
        subchunk_segmentation: {
          separator: '\n',
          max_tokens: 256,
        },
      }

      act(() => {
        result.current.applyConfigFromRules(rulesConfig, true)
      })

      expect(result.current.parentChildConfig.chunkForContext).toBe('full-doc')
      expect(result.current.parentChildConfig.child.maxLength).toBe(256)
    })
  })

  // --- getProcessRule ---
  describe('getProcessRule', () => {
    it('should build general process rule', () => {
      const { result } = renderHook(() => useSegmentationState())

      const rule = result.current.getProcessRule(ChunkingMode.text)
      expect(rule.mode).toBe(ProcessMode.general)
      expect(rule.rules!.segmentation.max_tokens).toBe(DEFAULT_MAXIMUM_CHUNK_LENGTH)
      expect(rule.rules!.segmentation.chunk_overlap).toBe(DEFAULT_OVERLAP)
    })

    it('should build parent-child process rule', () => {
      const { result } = renderHook(() => useSegmentationState())

      const rule = result.current.getProcessRule(ChunkingMode.parentChild)
      expect(rule.mode).toBe('hierarchical')
      expect(rule.rules!.parent_mode).toBe('paragraph')
      expect(rule.rules!.subchunk_segmentation).toBeDefined()
    })

    it('should include summary index setting in process rule', () => {
      const setting = { enable: true }
      const { result } = renderHook(() =>
        useSegmentationState({ initialSummaryIndexSetting: setting }),
      )

      const rule = result.current.getProcessRule(ChunkingMode.text)
      expect(rule.summary_index_setting).toEqual(setting)
    })
  })

  // --- Summary index setting ---
  describe('handleSummaryIndexSettingChange', () => {
    it('should update summary index setting', () => {
      const { result } = renderHook(() =>
        useSegmentationState({ initialSummaryIndexSetting: { enable: false } }),
      )

      act(() => {
        result.current.handleSummaryIndexSettingChange({ enable: true })
      })
      expect(result.current.summaryIndexSetting).toEqual({ enable: true })
    })

    it('should merge with existing setting', () => {
      const { result } = renderHook(() =>
        useSegmentationState({ initialSummaryIndexSetting: { enable: true } }),
      )

      act(() => {
        result.current.handleSummaryIndexSettingChange({ enable: false })
      })
      expect(result.current.summaryIndexSetting?.enable).toBe(false)
    })
  })
})
