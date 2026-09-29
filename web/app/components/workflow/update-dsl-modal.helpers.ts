import type { AppMode, Import } from '@dify/contracts/api/console/apps/types.gen'
import type { TFunction } from 'i18next'
import type { CommonNodeType, Node } from './types'
import { DSLImportStatus } from '@/models/app'
import { AppModeEnum } from '@/types/app'
import { loadYaml } from '@/utils/yaml'
import { BlockEnum } from './types'

type ParsedDSL = {
  workflow?: {
    graph?: {
      nodes?: Array<Node<CommonNodeType>>
    }
  }
}

type ImportNotificationPayload = {
  type: 'success' | 'warning'
  message: string
  children?: string
}

export const getInvalidNodeTypes = (mode?: AppMode): BlockEnum[] => {
  if (mode === AppModeEnum.ADVANCED_CHAT) {
    return [
      BlockEnum.End,
      BlockEnum.TriggerWebhook,
      BlockEnum.TriggerSchedule,
      BlockEnum.TriggerPlugin,
    ]
  }

  return [BlockEnum.Answer]
}

export const validateDSLContent = (content: string, mode?: AppMode) => {
  try {
    const data = loadYaml(content) as ParsedDSL | undefined
    const nodes = data?.workflow?.graph?.nodes ?? []
    const invalidNodes = getInvalidNodeTypes(mode)
    return !nodes.some((node: Node<CommonNodeType>) => invalidNodes.includes(node?.data?.type))
  } catch {
    return false
  }
}

export const isImportCompleted = (status: Import['status']) => {
  return status === DSLImportStatus.COMPLETED || status === DSLImportStatus.COMPLETED_WITH_WARNINGS
}

export const getImportNotificationPayload = (
  status: Import['status'],
  t: TFunction<['workflow']>,
): ImportNotificationPayload => {
  return {
    type: status === DSLImportStatus.COMPLETED ? 'success' : 'warning',
    message:
      status === DSLImportStatus.COMPLETED
        ? t(($) => $['common.importSuccess'], { ns: 'workflow' })
        : t(($) => $['common.importWarning'], { ns: 'workflow' }),
    children:
      status === DSLImportStatus.COMPLETED_WITH_WARNINGS
        ? t(($) => $['common.importWarningDetails'], { ns: 'workflow' })
        : undefined,
  }
}
