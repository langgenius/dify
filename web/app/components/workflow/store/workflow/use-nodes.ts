import {
  useStore,
} from '@/app/components/workflow/store'

const useWorkflowNodes = () => useStore(s => s.nodes)

export default useWorkflowNodes
