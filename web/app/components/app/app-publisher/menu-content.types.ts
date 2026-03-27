import type { CSSProperties } from 'react'
import type { ModelAndParameter } from '../configuration/debug/types'
import type { AppPublisherProps } from './index'
import type { AppDetailResponse } from '@/models/app'
import type { SystemFeatures } from '@/types/feature'
import type { PublishWorkflowParams } from '@/types/workflow'

export type AppPublisherMenuContentProps = Pick<
  AppPublisherProps,
  | 'publishedAt'
  | 'draftUpdatedAt'
  | 'debugWithMultipleModel'
  | 'multipleModelConfigs'
  | 'publishDisabled'
  | 'publishLoading'
  | 'toolPublished'
  | 'inputs'
  | 'outputs'
  | 'onRefreshData'
  | 'workflowToolAvailable'
  | 'hasTriggerNode'
  | 'missingStartNode'
  | 'startNodeLimitExceeded'
  | 'hasHumanInputNode'
> & {
  appDetail?: AppDetailResponse
  appURL: string
  disabledFunctionButton: boolean
  disabledFunctionTooltip?: string
  formatTimeFromNow: (time: number) => string
  isAppAccessSet: boolean
  isChatApp: boolean
  isGettingAppWhiteListSubjects: boolean
  isGettingUserCanAccessApp: boolean
  onOpenEmbedding: () => void
  onOpenInExplore: () => void
  onPublish: (params?: ModelAndParameter | PublishWorkflowParams) => Promise<void> | void
  onPublishToMarketplace: () => Promise<void> | void
  onRestore: () => Promise<void> | void
  onShowAppAccessControl: () => void
  published: boolean
  publishingToMarketplace: boolean
  systemFeatures: SystemFeatures
  upgradeHighlightStyle: CSSProperties
  workflowToolDisabled: boolean
  workflowToolMessage?: string
}
