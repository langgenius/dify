import ModelName from '../model-name'

type ModelDisplayProps = {
  currentModel: any
  modelId: string
}

const ModelDisplay = ({ currentModel, modelId }: ModelDisplayProps) => {
  return currentModel ? (
    <ModelName
      className="flex grow items-center gap-1 px-1 py-[3px]"
      modelItem={currentModel}
      showMode
      showFeatures
    />
  ) : (
    <div className="flex grow items-center gap-1 truncate px-1 py-[3px] opacity-50">
      <div className="text-components-input-text-filled system-sm-regular overflow-hidden text-ellipsis">
        {modelId}
      </div>
    </div>
  )
}

export default ModelDisplay
