import { useStore } from './store'

const PluginDependency = () => {
  const dependencies = useStore(s => s.dependencies)

  if (!dependencies.length)
    return null

  return (
    <div>a</div>
  )
}

export default PluginDependency
