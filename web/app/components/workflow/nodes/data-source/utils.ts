import { PipelineInputVarType } from '@/models/pipeline'
import { VarType } from '@/app/components/workflow/types'

export const inputVarTypeToVarType = (type: PipelineInputVarType): VarType => {
  return ({
    [PipelineInputVarType.number]: VarType.number,
    [PipelineInputVarType.singleFile]: VarType.file,
    [PipelineInputVarType.multiFiles]: VarType.arrayFile,
    [PipelineInputVarType.checkbox]: VarType.boolean,
  } as any)[type] || VarType.string
}
