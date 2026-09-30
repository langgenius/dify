import type { DefaultValueForm } from './types'
import type { CodeNodeType } from '@/app/components/workflow/nodes/code/types'
import type { CommonNodeType } from '@/app/components/workflow/types'
import { BlockEnum, VarType } from '@/app/components/workflow/types'

const getDefaultValueByType = (type: VarType) => {
  if (type === VarType.string) return ''

  if (type === VarType.number) return 0

  if (type === VarType.object) return '{}'

  if (
    type === VarType.arrayObject ||
    type === VarType.arrayString ||
    type === VarType.arrayNumber ||
    type === VarType.arrayFile
  )
    return '[]'

  return ''
}

export const getDefaultValue = (data: CommonNodeType) => {
  const { type } = data

  if (type === BlockEnum.LLM) {
    return [
      {
        key: 'text',
        type: VarType.string,
        value: getDefaultValueByType(VarType.string),
      },
    ]
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
        type: outputs[key]!.type,
        value: getDefaultValueByType(outputs[key]!.type),
      }
    })
  }

  return []
}

type RenamedKey = {
  from: string
  to: string
}

/**
 * Rebuilds the fallback values of a node while keeping what the user configured:
 * a value is kept when its variable is still there with the same name and type,
 * and a renamed variable keeps its value under the new name.
 */
export const mergeDefaultValue = (
  data: CommonNodeType,
  previous?: DefaultValueForm[],
  renamedKey?: RenamedKey,
) => {
  const newDefaultValue = getDefaultValue(data)
  if (!previous?.length) return newDefaultValue

  const previousByKey = new Map(
    previous.map((item) => [
      renamedKey && item.key === renamedKey.from ? renamedKey.to : item.key,
      item,
    ]),
  )

  return newDefaultValue.map((item) => {
    const previousItem = previousByKey.get(item.key)

    if (!previousItem || previousItem.type !== item.type) return item

    return {
      ...item,
      value: previousItem.value,
    }
  })
}
