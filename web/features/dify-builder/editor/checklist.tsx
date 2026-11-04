import type { WorkflowChecklistProps } from '@/app/components/workflow/header/checklist'
import type { CommonEdgeType } from '@/app/components/workflow/types'
import { useAtomValue, useSetAtom } from 'jotai'
import { useEffect, useMemo } from 'react'
import { useEdges } from 'reactflow'
import { ChecklistView } from '@/app/components/workflow/header/checklist'
import { useChecklist } from '@/app/components/workflow/hooks/use-checklist'
import useNodes from '@/app/components/workflow/store/workflow/use-nodes'
import BuilderFixButton from '../fix-button'
import {
  difyBuilderAvailableAtom,
  difyBuilderCanStartFixAtom,
  difyBuilderCanvasRefreshGenerationAtom,
  difyBuilderRegisterChecklistErrorsAtom,
  difyBuilderStartChecklistFixAtom,
} from '../state'

export function DifyBuilderChecklist(props: WorkflowChecklistProps) {
  const edges = useEdges<CommonEdgeType>()
  const nodes = useNodes()
  const items = useChecklist(nodes, edges)
  const available = useAtomValue(difyBuilderAvailableAtom)
  const generation = useAtomValue(difyBuilderCanvasRefreshGenerationAtom)
  const canStartFix = useAtomValue(difyBuilderCanStartFixAtom)
  const registerErrors = useSetAtom(difyBuilderRegisterChecklistErrorsAtom)
  const startFix = useSetAtom(difyBuilderStartChecklistFixAtom)
  const errors = useMemo(
    () =>
      items
        .filter(
          (item) => !item.unConnected && !item.isPluginMissing && item.errorMessages.length > 0,
        )
        .map((item) => ({
          node_id: item.id,
          node_type: String(item.type),
          title: item.title,
          messages: item.errorMessages,
          unconnected: !!item.unConnected,
          plugin_missing: !!item.isPluginMissing,
        })),
    [items],
  )

  useEffect(() => {
    registerErrors({ errors, generation })
  }, [errors, generation, registerErrors])

  return (
    <ChecklistView
      {...props}
      items={items}
      renderActions={(close) =>
        available &&
        errors.length > 0 && (
          <div className="mt-2 border-t border-divider-subtle pt-3">
            <BuilderFixButton
              disabled={props.disabled || !canStartFix}
              onClick={() => {
                close()
                void startFix(errors)
              }}
            />
          </div>
        )
      }
    />
  )
}
