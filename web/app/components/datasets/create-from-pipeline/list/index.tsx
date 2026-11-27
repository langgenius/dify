import type { RefObject } from 'react'
import BuiltInPipelineList from './built-in-pipeline-list'
import CustomizedList from './customized-list'

const List = ({ fallbackFocusRef }: { fallbackFocusRef: RefObject<HTMLAnchorElement | null> }) => {
  return (
    <div className="grow gap-y-1 overflow-y-auto px-16 pt-1 pb-15">
      <BuiltInPipelineList />
      <CustomizedList fallbackFocusRef={fallbackFocusRef} />
    </div>
  )
}

export default List
