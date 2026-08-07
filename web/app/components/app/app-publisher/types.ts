import type { ModelAndParameter } from '../configuration/debug/types'
import type { InputVar, Variable } from '@/app/components/workflow/types'
import type { PublishWorkflowParams } from '@/types/workflow'

export type AppPublisherPublishParams = ModelAndParameter | PublishWorkflowParams

export type AppPublisherPublishHandler =
  | ((params?: AppPublisherPublishParams) => Promise<unknown> | unknown)
  | ((params?: unknown) => Promise<unknown> | unknown)

export type AppPublisherRestoreHandler = () => Promise<unknown> | unknown

export type AppPublisherProps = {
  disabled?: boolean
  publishDisabled?: boolean
  publishedAt?: number
  /** only needed in workflow / chatflow mode */
  draftUpdatedAt?: number
  /** Current persisted workflow draft hash, used to compare with the published workflow. */
  draftHash?: string
  /** Non-workflow editors should pass their local dirty state. */
  hasUnpublishedChanges?: boolean
  debugWithMultipleModel?: boolean
  multipleModelConfigs?: ModelAndParameter[]
  /** modelAndParameter is passed when debugWithMultipleModel is true */
  onPublish?: AppPublisherPublishHandler
  onRestore?: AppPublisherRestoreHandler
  onToggle?: (state: boolean) => void
  crossAxisOffset?: number
  toolPublished?: boolean
  inputs?: InputVar[]
  outputs?: Variable[]
  onRefreshData?: () => void
  workflowToolAvailable?: boolean
  missingStartNode?: boolean
  hasTriggerNode?: boolean
  startNodeLimitExceeded?: boolean
  hasHumanInputNode?: boolean
}
