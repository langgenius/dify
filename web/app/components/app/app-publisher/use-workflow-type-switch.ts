import type { ModelAndParameter } from '../configuration/debug/types'
import type { App, AppSSO } from '@/types/app'
import type { EvaluationWorkflowAssociatedTarget } from '@/types/evaluation'
import type { I18nKeysWithPrefix } from '@/types/i18n'
import type { PublishWorkflowParams, WorkflowKind, WorkflowTypeConversionTarget } from '@/types/workflow'
import { toast } from '@langgenius/dify-ui/toast'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchAppDetailDirect } from '@/service/apps'
import { useConvertWorkflowTypeMutation } from '@/service/use-apps'
import { useEvaluationWorkflowAssociatedTargets } from '@/service/use-evaluation'
import { AppModeEnum, AppTypeEnum } from '@/types/app'

type WorkflowTypeSwitchLabelKey = I18nKeysWithPrefix<'workflow', 'common.'>

export type WorkflowTypeSwitchConfig = {
  targetType: WorkflowTypeConversionTarget
  publishLabelKey: WorkflowTypeSwitchLabelKey
  switchLabelKey: WorkflowTypeSwitchLabelKey
  tipKey: WorkflowTypeSwitchLabelKey
}

const WORKFLOW_TYPE_SWITCH_CONFIG: Record<WorkflowTypeConversionTarget, WorkflowTypeSwitchConfig> = {
  workflow: {
    targetType: 'evaluation',
    publishLabelKey: 'common.publishAsEvaluationWorkflow',
    switchLabelKey: 'common.switchToEvaluationWorkflow',
    tipKey: 'common.switchToEvaluationWorkflowTip',
  },
  evaluation: {
    targetType: 'workflow',
    publishLabelKey: 'common.publishAsStandardWorkflow',
    switchLabelKey: 'common.switchToStandardWorkflow',
    tipKey: 'common.switchToStandardWorkflowTip',
  },
} as const

const getWorkflowTypeSwitchConfig = (workflowKind?: WorkflowKind | null) => {
  if (!workflowKind || workflowKind === 'standard')
    return WORKFLOW_TYPE_SWITCH_CONFIG.workflow

  if (workflowKind === 'evaluation')
    return WORKFLOW_TYPE_SWITCH_CONFIG.evaluation
}

type UseWorkflowTypeSwitchParams = {
  appDetail?: App & Partial<AppSSO>
  canAccessSnippetsAndEvaluation: boolean
  hasHumanInputNode: boolean
  hasTriggerNode: boolean
  onPublish: (params?: ModelAndParameter | PublishWorkflowParams) => Promise<void>
  onPublishedSwitch: () => void
  published: boolean
  publishedAt?: number
  publishDisabled: boolean
  setAppDetail: (appDetail?: App & Partial<AppSSO>) => void
}

export const useWorkflowTypeSwitch = ({
  appDetail,
  canAccessSnippetsAndEvaluation,
  hasHumanInputNode,
  hasTriggerNode,
  onPublish,
  onPublishedSwitch,
  published,
  publishedAt,
  publishDisabled,
  setAppDetail,
}: UseWorkflowTypeSwitchParams) => {
  const { t } = useTranslation()
  const [showEvaluationWorkflowSwitchConfirm, setShowEvaluationWorkflowSwitchConfirm] = useState(false)
  const [evaluationWorkflowSwitchTargets, setEvaluationWorkflowSwitchTargets] = useState<EvaluationWorkflowAssociatedTarget[]>([])
  const { mutateAsync: convertWorkflowType, isPending: isConvertingWorkflowType } = useConvertWorkflowTypeMutation()
  const {
    refetch: refetchEvaluationWorkflowAssociatedTargets,
    isFetching: isFetchingEvaluationWorkflowAssociatedTargets,
  } = useEvaluationWorkflowAssociatedTargets(appDetail?.id, { enabled: false })

  const workflowTypeSwitchConfig = useMemo(() => {
    if (appDetail?.mode !== AppModeEnum.WORKFLOW)
      return undefined

    return getWorkflowTypeSwitchConfig(appDetail?.workflow_kind)
  }, [appDetail?.mode, appDetail?.workflow_kind])

  const workflowTypeSwitchDisabledReason = useMemo(() => {
    if (workflowTypeSwitchConfig?.targetType !== AppTypeEnum.EVALUATION)
      return undefined

    if (!canAccessSnippetsAndEvaluation)
      return t('compliance.sandboxUpgradeTooltip', { ns: 'common' })

    if (!hasHumanInputNode && !hasTriggerNode)
      return undefined

    return t('common.switchToEvaluationWorkflowDisabledTip', { ns: 'workflow' })
  }, [canAccessSnippetsAndEvaluation, hasHumanInputNode, hasTriggerNode, t, workflowTypeSwitchConfig?.targetType])

  const getWorkflowTypeSwitchPublishUrl = useCallback(() => {
    if (!appDetail?.id || !workflowTypeSwitchConfig)
      return undefined

    if (workflowTypeSwitchConfig.targetType === AppTypeEnum.EVALUATION)
      return `/apps/${appDetail.id}/workflows/publish/evaluation`

    return `/apps/${appDetail.id}/workflows/publish`
  }, [appDetail?.id, workflowTypeSwitchConfig])

  const resetEvaluationWorkflowSwitchConfirm = useCallback(() => {
    setShowEvaluationWorkflowSwitchConfirm(false)
    setEvaluationWorkflowSwitchTargets([])
  }, [])

  const performWorkflowTypeSwitch = useCallback(async () => {
    if (!appDetail?.id || !workflowTypeSwitchConfig)
      return false

    try {
      if (!publishedAt) {
        const publishUrl = getWorkflowTypeSwitchPublishUrl()
        if (!publishUrl)
          return false

        await onPublish({
          url: publishUrl,
          title: '',
          releaseNotes: '',
        })

        const latestAppDetail = await fetchAppDetailDirect({
          url: '/apps',
          id: appDetail.id,
        })
        setAppDetail(latestAppDetail)
        resetEvaluationWorkflowSwitchConfirm()
        toast.success(t('api.actionSuccess', { ns: 'common' }))
        return true
      }

      await convertWorkflowType({
        params: {
          appId: appDetail.id,
        },
        query: {
          target_type: workflowTypeSwitchConfig.targetType,
        },
      })

      const latestAppDetail = await fetchAppDetailDirect({
        url: '/apps',
        id: appDetail.id,
      })
      setAppDetail(latestAppDetail)
      onPublishedSwitch()
      resetEvaluationWorkflowSwitchConfirm()
      toast.success(t('api.actionSuccess', { ns: 'common' }))
      return true
    }
    catch {
      return false
    }
  }, [
    appDetail?.id,
    convertWorkflowType,
    getWorkflowTypeSwitchPublishUrl,
    onPublish,
    onPublishedSwitch,
    publishedAt,
    resetEvaluationWorkflowSwitchConfirm,
    setAppDetail,
    t,
    workflowTypeSwitchConfig,
  ])

  const handleWorkflowTypeSwitch = useCallback(async () => {
    if (!appDetail?.id || !workflowTypeSwitchConfig)
      return

    if (workflowTypeSwitchDisabledReason) {
      toast.error(workflowTypeSwitchDisabledReason)
      return
    }

    if (appDetail.workflow_kind === AppTypeEnum.EVALUATION && workflowTypeSwitchConfig.targetType === AppTypeEnum.WORKFLOW) {
      const associatedTargetsResult = await refetchEvaluationWorkflowAssociatedTargets()

      if (associatedTargetsResult.isError) {
        toast.error(t('common.switchToStandardWorkflowConfirm.loadFailed', { ns: 'workflow' }))
        return
      }

      const associatedTargets = associatedTargetsResult.data?.items ?? []
      if (associatedTargets.length > 0) {
        setEvaluationWorkflowSwitchTargets(associatedTargets)
        setShowEvaluationWorkflowSwitchConfirm(true)
        return
      }
    }

    await performWorkflowTypeSwitch()
  }, [
    appDetail?.id,
    appDetail?.workflow_kind,
    performWorkflowTypeSwitch,
    refetchEvaluationWorkflowAssociatedTargets,
    t,
    workflowTypeSwitchConfig,
    workflowTypeSwitchDisabledReason,
  ])

  const handleEvaluationWorkflowSwitchConfirmOpenChange = useCallback((nextOpen: boolean) => {
    setShowEvaluationWorkflowSwitchConfirm(nextOpen)

    if (!nextOpen)
      setEvaluationWorkflowSwitchTargets([])
  }, [])

  return {
    evaluationWorkflowSwitchTargets,
    handleEvaluationWorkflowSwitchConfirmOpenChange,
    handleWorkflowTypeSwitch,
    isConvertingWorkflowType,
    isEvaluationWorkflowType: appDetail?.workflow_kind === AppTypeEnum.EVALUATION,
    performWorkflowTypeSwitch,
    showEvaluationWorkflowSwitchConfirm,
    workflowTypeSwitchConfig,
    workflowTypeSwitchDisabled: publishDisabled
      || published
      || isConvertingWorkflowType
      || isFetchingEvaluationWorkflowAssociatedTargets
      || Boolean(workflowTypeSwitchDisabledReason),
    workflowTypeSwitchDisabledReason,
  }
}
