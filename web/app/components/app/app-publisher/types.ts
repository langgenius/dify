import type { ModelAndParameter } from '../configuration/debug/types'
import type { WorkflowToolOutputVariable } from '@/app/components/tools/types'
import type { InputVar } from '@/app/components/workflow/types'
import type { PublishWorkflowParams } from '@/types/workflow'

export type AppPublisherPublishParams = ModelAndParameter | PublishWorkflowParams

export type AppPublisherPublishOptions = {
  showSuccessToast?: boolean
}

type AppPublisherPublishHandler =
  | ((
      params?: AppPublisherPublishParams,
      options?: AppPublisherPublishOptions,
    ) => Promise<unknown> | unknown)
  | ((params?: unknown, options?: AppPublisherPublishOptions) => Promise<unknown> | unknown)

type AppPublisherRestoreHandler = () => Promise<unknown> | unknown

export type AppPublisherProps = {
  disabled?: boolean
  publishDisabled?: boolean
  publishedAt?: number
  /** only needed in workflow / chatflow mode */
  draftUpdatedAt?: number
  debugWithMultipleModel?: boolean
  multipleModelConfigs?: ModelAndParameter[]
  /** modelAndParameter is passed when debugWithMultipleModel is true */
  onPublish?: AppPublisherPublishHandler
  onRestore?: AppPublisherRestoreHandler
  onToggle?: (state: boolean) => void
  crossAxisOffset?: number
  toolPublished?: boolean
  inputs?: InputVar[]
  outputs?: WorkflowToolOutputVariable[]
  onRefreshData?: () => void
  workflowToolAvailable?: boolean
  missingStartNode?: boolean
  hasTriggerNode?: boolean
  startNodeLimitExceeded?: boolean
  hasHumanInputNode?: boolean
}
