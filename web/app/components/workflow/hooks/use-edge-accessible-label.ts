import type { HumanInputNodeType } from '../nodes/human-input/types'
import type { CommonNodeType } from '../types'
import { useLayoutEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore } from 'reactflow'
import { ErrorHandleTypeEnum } from '../nodes/_base/components/error-handle/types'
import { BlockEnum } from '../types'

export const useEdgeAccessibleLabel = (
  source: string,
  target: string,
  sourceHandleId?: string | null,
) => {
  const { t } = useTranslation()
  const edgeRef = useRef<SVGGElement>(null)
  const label = useStore((state) => {
    // React Flow's node map keeps this subscription local to the two endpoints.
    const sourceData = state.nodeInternals.get(source)?.data as CommonNodeType | undefined
    const targetData = state.nodeInternals.get(target)?.data as CommonNodeType | undefined
    if (!sourceData || !targetData) return undefined

    let branchName = sourceData._targetBranches?.find(
      (branch) => branch.id === sourceHandleId,
    )?.name
    if (sourceData.type === BlockEnum.QuestionClassifier) {
      const branchIndex =
        sourceData._targetBranches?.findIndex((branch) => branch.id === sourceHandleId) ?? -1
      if (branchIndex >= 0) {
        const classLabel = `${t(($) => $['nodes.questionClassifiers.class'], { ns: 'workflow' })} ${branchIndex + 1}`
        branchName = branchName ? `${classLabel}: ${branchName}` : classLabel
      }
    }
    if (sourceData.type === BlockEnum.HumanInput) {
      branchName =
        sourceHandleId === '__timeout'
          ? t(($) => $['nodes.humanInput.timeout.title'], { ns: 'workflow' })
          : (sourceData as HumanInputNodeType).user_actions?.find(
              (action) => action.id === sourceHandleId,
            )?.title ||
            sourceHandleId ||
            undefined
    }
    if (sourceHandleId === ErrorHandleTypeEnum.failBranch)
      branchName = t(($) => $['common.onFailure'], { ns: 'workflow' })

    const sourceTitle =
      sourceData.title || t(($) => $[`blocks.${sourceData.type}`], { ns: 'workflow' })
    const targetTitle =
      targetData.title || t(($) => $[`blocks.${targetData.type}`], { ns: 'workflow' })
    return t(($) => $['common.edgeLabel'], {
      ns: 'workflow',
      source: branchName ? `${sourceTitle} (${branchName})` : sourceTitle,
      target: targetTitle,
    })
  })

  useLayoutEffect(() => {
    // React Flow 11 owns the focusable wrapper and has no wrapper slot. Keep its
    // accessible name in the rendered SVG, out of persisted graph edge data.
    const edgeWrapper = edgeRef.current?.closest('.react-flow__edge')
    if (edgeWrapper && label) edgeWrapper.setAttribute('aria-label', label)
  }, [label, source, target])

  return edgeRef
}
