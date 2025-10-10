import { useStore } from 'reactflow'
import { isSystemVar } from '@/app/components/workflow/nodes/_base/components/variable/utils'
import { BlockEnum } from '@/app/components/workflow/types'
import type { Node, ValueSelector } from '@/app/components/workflow/types'

export const useFindNode = (valueSelector: ValueSelector = [], nodes: Node[] = []) => {
  const nodeFromOuterNodes = nodes.find(node => node.id === valueSelector[0])
  const node = useStore((s) => {
    const nodes = s.getNodes()
    if (isSystemVar(valueSelector))
      return nodes.find(node => node.data.type === BlockEnum.Start)
    return nodes.find(node => node.id === valueSelector[0])
  })

  return nodeFromOuterNodes || node
}
