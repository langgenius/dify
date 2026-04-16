import BuiltInPipelineList from './built-in-pipeline-list'
import CustomizedList from './customized-list'

const List = () => {
  return (
    <div className="grow gap-y-1 overflow-y-auto px-16 pt-1 pb-[60px]">
      <BuiltInPipelineList />
      <CustomizedList />
    </div>
  )
}

export default List
