import type {
  DocumentProcessRulesResponse,
  PreProcessingRule,
  Rule,
} from '@dify/contracts/api/console/datasets/types.gen'
import type { Rules } from '@/models/datasets'
import { ProcessMode } from '@/models/datasets'

const PRE_PROCESSING_RULE_IDS = new Set<string>([
  'remove_extra_spaces',
  'remove_stopwords',
  'remove_urls_emails',
] satisfies PreProcessingRule['id'][])

const isPreProcessingRule = (rule: { id: string; enabled: boolean }): rule is PreProcessingRule =>
  PRE_PROCESSING_RULE_IDS.has(rule.id)

export const isProcessMode = (mode: string): mode is ProcessMode =>
  Object.values<string>(ProcessMode).includes(mode)

type StoredRules = DocumentProcessRulesResponse | Rule

const toSegmentation = (segmentation: NonNullable<StoredRules['segmentation']>) => ({
  // The backend defaults an unspecified separator to a newline and overlap to zero.
  separator: segmentation.separator ?? '\n',
  max_tokens: segmentation.max_tokens,
  chunk_overlap: segmentation.chunk_overlap ?? 0,
})

/**
 * Segmentation settings from a stored process rule. Automatic-mode rules store no segmentation,
 * so there is nothing to restore for them.
 */
export const toSegmentationRules = (rules: StoredRules): Rules | undefined => {
  if (!rules.segmentation) return undefined
  return {
    pre_processing_rules: (rules.pre_processing_rules ?? []).filter(isPreProcessingRule),
    segmentation: toSegmentation(rules.segmentation),
    parent_mode: rules.parent_mode ?? undefined,
    subchunk_segmentation: rules.subchunk_segmentation
      ? toSegmentation(rules.subchunk_segmentation)
      : undefined,
  }
}
