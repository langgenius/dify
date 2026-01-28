import type { ParentMode, PreProcessingRule, ProcessRule, Rules, SummaryIndexSetting as SummaryIndexSettingType } from '@/models/datasets'
import { useCallback, useRef, useState } from 'react'
import { ChunkingMode, ProcessMode } from '@/models/datasets'
import escape from './escape'
import unescape from './unescape'

// Constants
export const DEFAULT_SEGMENT_IDENTIFIER = '\\n\\n'
export const DEFAULT_MAXIMUM_CHUNK_LENGTH = 1024
export const DEFAULT_OVERLAP = 50
export const MAXIMUM_CHUNK_TOKEN_LENGTH = Number.parseInt(
  globalThis.document?.body?.getAttribute('data-public-indexing-max-segmentation-tokens-length') || '4000',
  10,
)

export type ParentChildConfig = {
  chunkForContext: ParentMode
  parent: {
    delimiter: string
    maxLength: number
  }
  child: {
    delimiter: string
    maxLength: number
  }
}

export const defaultParentChildConfig: ParentChildConfig = {
  chunkForContext: 'paragraph',
  parent: {
    delimiter: '\\n\\n',
    maxLength: 1024,
  },
  child: {
    delimiter: '\\n',
    maxLength: 512,
  },
}

export type UseSegmentationStateOptions = {
  initialSegmentationType?: ProcessMode
  initialSummaryIndexSetting?: SummaryIndexSettingType
}

export const useSegmentationState = (options: UseSegmentationStateOptions = {}) => {
  const { initialSegmentationType, initialSummaryIndexSetting } = options

  // Segmentation type (general or parent-child)
  const [segmentationType, setSegmentationType] = useState<ProcessMode>(
    initialSegmentationType ?? ProcessMode.general,
  )

  // General chunking settings
  const [segmentIdentifier, doSetSegmentIdentifier] = useState(DEFAULT_SEGMENT_IDENTIFIER)
  const [maxChunkLength, setMaxChunkLength] = useState(DEFAULT_MAXIMUM_CHUNK_LENGTH)
  const [limitMaxChunkLength, setLimitMaxChunkLength] = useState(MAXIMUM_CHUNK_TOKEN_LENGTH)
  const [overlap, setOverlap] = useState(DEFAULT_OVERLAP)

  // Pre-processing rules
  const [rules, setRules] = useState<PreProcessingRule[]>([])
  const [defaultConfig, setDefaultConfig] = useState<Rules>()
  const [summaryIndexSetting, setSummaryIndexSetting] = useState<SummaryIndexSettingType | undefined>(initialSummaryIndexSetting)
  const summaryIndexSettingRef = useRef<SummaryIndexSettingType | undefined>(initialSummaryIndexSetting)
  const handleSummaryIndexSettingChange = useCallback((payload: SummaryIndexSettingType) => {
    setSummaryIndexSetting((prev) => {
      const newSetting = { ...prev, ...payload }
      summaryIndexSettingRef.current = newSetting
      return newSetting
    })
  }, [])

  // Parent-child config
  const [parentChildConfig, setParentChildConfig] = useState<ParentChildConfig>(defaultParentChildConfig)

  // Escaped segment identifier setter
  const setSegmentIdentifier = useCallback((value: string, canEmpty?: boolean) => {
    if (value) {
      doSetSegmentIdentifier(escape(value))
    }
    else {
      doSetSegmentIdentifier(canEmpty ? '' : DEFAULT_SEGMENT_IDENTIFIER)
    }
  }, [])

  // Rule toggle handler
  const toggleRule = useCallback((id: string) => {
    setRules(prev => prev.map(rule =>
      rule.id === id ? { ...rule, enabled: !rule.enabled } : rule,
    ))
  }, [])

  // Reset to defaults
  const resetToDefaults = useCallback(() => {
    if (defaultConfig) {
      setSegmentIdentifier(defaultConfig.segmentation.separator)
      setMaxChunkLength(defaultConfig.segmentation.max_tokens)
      setOverlap(defaultConfig.segmentation.chunk_overlap!)
      setRules(defaultConfig.pre_processing_rules)
    }
    setParentChildConfig(defaultParentChildConfig)
  }, [defaultConfig, setSegmentIdentifier])

  // Apply config from document detail
  const applyConfigFromRules = useCallback((rulesConfig: Rules, isHierarchical: boolean) => {
    const separator = rulesConfig.segmentation.separator
    const max = rulesConfig.segmentation.max_tokens
    const chunkOverlap = rulesConfig.segmentation.chunk_overlap

    setSegmentIdentifier(separator)
    setMaxChunkLength(max)
    setOverlap(chunkOverlap!)
    setRules(rulesConfig.pre_processing_rules)
    setDefaultConfig(rulesConfig)

    if (isHierarchical) {
      setParentChildConfig({
        chunkForContext: rulesConfig.parent_mode || 'paragraph',
        parent: {
          delimiter: escape(rulesConfig.segmentation.separator),
          maxLength: rulesConfig.segmentation.max_tokens,
        },
        child: {
          delimiter: escape(rulesConfig.subchunk_segmentation!.separator),
          maxLength: rulesConfig.subchunk_segmentation!.max_tokens,
        },
      })
    }
  }, [setSegmentIdentifier])

  // Get process rule for API
  const getProcessRule = useCallback((docForm: ChunkingMode): ProcessRule => {
    if (docForm === ChunkingMode.parentChild) {
      return {
        rules: {
          pre_processing_rules: rules,
          segmentation: {
            separator: unescape(parentChildConfig.parent.delimiter),
            max_tokens: parentChildConfig.parent.maxLength,
          },
          parent_mode: parentChildConfig.chunkForContext,
          subchunk_segmentation: {
            separator: unescape(parentChildConfig.child.delimiter),
            max_tokens: parentChildConfig.child.maxLength,
          },
        },
        mode: 'hierarchical',
        summary_index_setting: summaryIndexSettingRef.current,
      } as ProcessRule
    }

    return {
      rules: {
        pre_processing_rules: rules,
        segmentation: {
          separator: unescape(segmentIdentifier),
          max_tokens: maxChunkLength,
          chunk_overlap: overlap,
        },
      },
      mode: segmentationType,
      summary_index_setting: summaryIndexSettingRef.current,
    } as ProcessRule
  }, [rules, parentChildConfig, segmentIdentifier, maxChunkLength, overlap, segmentationType])

  // Update parent config field
  const updateParentConfig = useCallback((field: 'delimiter' | 'maxLength', value: string | number) => {
    setParentChildConfig((prev) => {
      let newValue: string | number
      if (field === 'delimiter')
        newValue = value ? escape(value as string) : ''
      else
        newValue = value
      return {
        ...prev,
        parent: { ...prev.parent, [field]: newValue },
      }
    })
  }, [])

  // Update child config field
  const updateChildConfig = useCallback((field: 'delimiter' | 'maxLength', value: string | number) => {
    setParentChildConfig((prev) => {
      let newValue: string | number
      if (field === 'delimiter')
        newValue = value ? escape(value as string) : ''
      else
        newValue = value
      return {
        ...prev,
        child: { ...prev.child, [field]: newValue },
      }
    })
  }, [])

  // Set chunk for context mode
  const setChunkForContext = useCallback((mode: ParentMode) => {
    setParentChildConfig(prev => ({ ...prev, chunkForContext: mode }))
  }, [])

  return {
    // General chunking state
    segmentationType,
    setSegmentationType,
    segmentIdentifier,
    setSegmentIdentifier,
    maxChunkLength,
    setMaxChunkLength,
    limitMaxChunkLength,
    setLimitMaxChunkLength,
    overlap,
    setOverlap,

    // Rules
    rules,
    setRules,
    defaultConfig,
    setDefaultConfig,
    toggleRule,
    summaryIndexSetting,
    handleSummaryIndexSettingChange,

    // Parent-child config
    parentChildConfig,
    setParentChildConfig,
    updateParentConfig,
    updateChildConfig,
    setChunkForContext,

    // Actions
    resetToDefaults,
    applyConfigFromRules,
    getProcessRule,
  }
}

export type SegmentationState = ReturnType<typeof useSegmentationState>
