import {
  useStore,
} from '../../store'

const useWorkflowNodes = () => useStore(s => s.nodes)

export default useWorkflowNodes
