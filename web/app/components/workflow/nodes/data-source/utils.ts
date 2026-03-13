import { VarType } from '@/app/components/workflow/types'
import { PipelineInputVarType } from '@/models/pipeline'

export const inputVarTypeToVarType = (type: PipelineInputVarType): VarType => {
  return ({
    [PipelineInputVarType.number]: VarType.number,
    [PipelineInputVarType.singleFile]: VarType.file,
    [PipelineInputVarType.multiFiles]: VarType.arrayFile,
    [PipelineInputVarType.checkbox]: VarType.boolean,
  } as any)[type] || VarType.string
}
