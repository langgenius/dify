import {
  useStore,
} from '@/app/components/workflow/store'
// import { useNodes as useFlowNodes } from 'reactflow'
// const nodes = useFlowNodes()

const useNodes = () => {
  const nodes = useStore(s => s.nodes)
  return nodes
}

export default useNodes
