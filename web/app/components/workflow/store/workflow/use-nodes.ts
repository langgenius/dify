import {
  useStore,
} from '@/app/components/workflow/store'

const useNodes = () => {
  const nodes = useStore(s => s.nodes)
  return nodes
}

export default useNodes
