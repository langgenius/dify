import { useStore } from '../../workflow/store'
import InputField from './input-field'
import RagPipelinePanel from './panel'
import RagPipelineHeader from './rag-pipeline-header'

const RagPipelineChildren = () => {
  const showInputFieldDialog = useStore(state => state.showInputFieldDialog)

  return (
    <>
      <RagPipelineHeader />
      <RagPipelinePanel />
      {
        showInputFieldDialog && (<InputField />)
      }
    </>
  )
}

export default RagPipelineChildren
