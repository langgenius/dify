import type { PopoverContentProps } from '@langgenius/dify-ui/popover'
import type { ModelAndParameter } from '../configuration/debug/types'
import type { WorkflowToolOutputVariable } from '@/app/components/tools/types'
import type { InputVar } from '@/app/components/workflow/types'
import type { PublishWorkflowParams, WorkflowKind } from '@/types/workflow'

export type AppPublisherPublishParams = ModelAndParameter | PublishWorkflowParams

export type AppPublisherPublishOptions = {
  showSuccessToast?: boolean
}

export type AppPublisherPublishHandler =
  | ((
      params?: AppPublisherPublishParams,
      options?: AppPublisherPublishOptions,
    ) => Promise<unknown> | unknown)
  | ((params?: unknown, options?: AppPublisherPublishOptions) => Promise<unknown> | unknown)

type AppPublisherRestoreHandler = () => Promise<unknown> | unknown

export type AppPublisherWorkflowKindChangeHandler = (
  targetKind: WorkflowKind,
) => Promise<unknown> | unknown

export type AppPublisherProps = Pick<PopoverContentProps, 'alignOffset'> & {
  appId: string
  disabled?: boolean
  publishDisabled?: boolean
  publishedAt?: number
  /** only needed in workflow / chatflow mode */
  draftUpdatedAt?: number
  debugWithMultipleModel?: boolean
  multipleModelConfigs?: ModelAndParameter[]
  /** modelAndParameter is passed when debugWithMultipleModel is true */
  onPublish?: AppPublisherPublishHandler
  onPublishEvaluation?: AppPublisherPublishHandler
  onConvertWorkflowKind?: AppPublisherWorkflowKindChangeHandler
  workflowKindChangePending?: boolean
  onRestore?: AppPublisherRestoreHandler
  onToggle?: (state: boolean) => void
  toolPublished?: boolean
  inputs?: InputVar[]
  outputs?: WorkflowToolOutputVariable[]
  onRefreshData?: () => void
  workflowToolAvailable?: boolean
  missingStartNode?: boolean
  hasTriggerNode?: boolean
  startNodeLimitExceeded?: boolean
}
