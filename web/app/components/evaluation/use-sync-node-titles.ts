import type { DefaultMetric } from '@dify/contracts/api/console/evaluate-target-type/types.gen'
import type { EvaluationResourceType } from './types'
import { useEffect, useMemo } from 'react'
import { useEvaluationResource, useEvaluationStore } from './store'

/**
 * Keep node titles in the config in step with the published workflow, so renaming a node
 * and republishing updates metric chips, condition labels and template columns.
 */
export const useSyncNodeTitles = (
  resourceType: EvaluationResourceType,
  resourceId: string,
  defaultMetrics: DefaultMetric[] | undefined,
) => {
  const syncNodeTitles = useEvaluationStore((state) => state.syncNodeTitles)
  const metrics = useEvaluationResource(resourceType, resourceId).metrics
  const nodeTitles = useMemo(() => {
    const titles = new Map<string, string>()

    defaultMetrics?.forEach((defaultMetric) => {
      defaultMetric.node_info_list?.forEach((nodeInfo) => {
        if (nodeInfo.title) titles.set(nodeInfo.node_id, nodeInfo.title)
      })
    })

    return titles
  }, [defaultMetrics])

  // Re-run when metrics change too: the saved config can hydrate after the node list loads.
  useEffect(() => {
    if (nodeTitles.size === 0) return

    syncNodeTitles(resourceType, resourceId, nodeTitles)
  }, [metrics, nodeTitles, resourceId, resourceType, syncNodeTitles])
}
