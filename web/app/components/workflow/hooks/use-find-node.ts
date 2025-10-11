import { useMemo } from 'react'
import { useStore } from 'reactflow'
import { useShallow } from 'zustand/react/shallow'
import { isSystemVar } from '@/app/components/workflow/nodes/_base/components/variable/utils'
import { BlockEnum } from '@/app/components/workflow/types'
import type { Node, ValueSelector } from '@/app/components/workflow/types'

export const useFindNode = (valueSelector: ValueSelector = [], nodes: Node[] = []) => {
  const nodeFromOuterNodes = nodes.find(node => node.id === valueSelector[0])
  const node = useStore(useShallow((s) => {
    if (isSystemVar(valueSelector)) {
      for (const n of s.nodeInternals.values()) {
        if (n?.data?.type === BlockEnum.Start) {
          return {
            id: n.id,
            data: n.data,
          }
        }
      }
    }
    else {
      if (!!valueSelector.length) {
        const id = s.nodeInternals.get(valueSelector[0])?.id
        const data = s.nodeInternals.get(valueSelector[0])?.data
        if (id && data) {
          return {
            id,
            data,
          }
        }
      }
    }
  }))

  return useMemo(() => nodeFromOuterNodes || node, [nodeFromOuterNodes, node])
}
