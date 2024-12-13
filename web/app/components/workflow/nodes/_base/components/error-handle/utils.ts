import type { CommonNodeType } from '@/app/components/workflow/types'
import {
  BlockEnum,
  VarType,
} from '@/app/components/workflow/types'
import type { CodeNodeType } from '@/app/components/workflow/nodes/code/types'

const getDefaultValueByType = (type: VarType) => {
  if (type === VarType.string)
    return ''

  if (type === VarType.number)
    return 0

  if (type === VarType.object)
    return '{}'

  if (type === VarType.arrayObject || type === VarType.arrayString || type === VarType.arrayNumber || type === VarType.arrayFile)
    return '[]'

  return ''
}

export const getDefaultValue = (data: CommonNodeType) => {
  const { type } = data

  if (type === BlockEnum.LLM) {
    return [{
      key: 'text',
      type: VarType.string,
      value: getDefaultValueByType(VarType.string),
    }]
  }

  if (type === BlockEnum.HttpRequest) {
    return [
      {
        key: 'body',
        type: VarType.string,
        value: getDefaultValueByType(VarType.string),
      },
      {
        key: 'status_code',
        type: VarType.number,
        value: getDefaultValueByType(VarType.number),
      },
      {
        key: 'headers',
        type: VarType.object,
        value: getDefaultValueByType(VarType.object),
      },
    ]
  }

  if (type === BlockEnum.Tool) {
    return [
      {
        key: 'text',
        type: VarType.string,
        value: getDefaultValueByType(VarType.string),
      },
      {
        key: 'json',
        type: VarType.arrayObject,
        value: getDefaultValueByType(VarType.arrayObject),
      },
    ]
  }

  if (type === BlockEnum.Code) {
    const { outputs } = data as CodeNodeType

    return Object.keys(outputs).map((key) => {
      return {
        key,
        type: outputs[key].type,
        value: getDefaultValueByType(outputs[key].type),
      }
    })
  }

  return []
}
