import {
  useCallback,
  useState,
} from 'react'
import { ErrorHandleTypeEnum } from './types'
import type { DefaultValueForm } from './types'
import type { Node } from '@/app/components/workflow/types'
import {
  BlockEnum,
  VarType,
} from '@/app/components/workflow/types'
import {
  useEdgesInteractions,
  useNodeDataUpdate,
} from '@/app/components/workflow/hooks'
import type { CodeNodeType } from '@/app/components/workflow/nodes/code/types'

type UseGetDefaultValueForms = (params: Pick<Node, 'id' | 'data'>) => DefaultValueForm[]
export const useGetDefaultValueForms: UseGetDefaultValueForms = ({
  data,
}) => {
  const { type, error_strategy } = data

  if (error_strategy === ErrorHandleTypeEnum.defaultValue) {
    if (type === BlockEnum.LLM) {
      return [{
        key: 'text',
        type: VarType.string,
      }]
    }

    if (type === BlockEnum.HttpRequest) {
      return [
        {
          key: 'body',
          type: VarType.string,
        },
        {
          key: 'status_code',
          type: VarType.number,
        },
        {
          key: 'headers',
          type: VarType.object,
        },
        {
          key: 'files',
          type: VarType.arrayFile,
          value: [],
        },
      ]
    }

    if (type === BlockEnum.Tool) {
      return [
        {
          key: 'text',
          type: VarType.string,
        },
        {
          key: 'files',
          type: VarType.arrayFile,
          value: [],
        },
        {
          key: 'json',
          type: VarType.arrayObject,
        },
      ]
    }

    if (type === BlockEnum.Code) {
      const { outputs } = data as CodeNodeType

      return Object.keys(outputs).map((key) => {
        return {
          key,
          type: outputs[key].type,
        }
      })
    }
  }

  return []
}

export const useDefaultValue = ({
  id,
  data,
}: Pick<Node, 'id' | 'data'>) => {
  const { handleNodeDataUpdateWithSyncDraft } = useNodeDataUpdate()
  const handleFormChange = useCallback(({
    key,
    value,
    type,
  }: DefaultValueForm) => {
    const default_value = data.default_value || []
    const index = default_value.findIndex(form => form.key === key)

    console.log(default_value, value)

    if (index > -1) {
      const newDefaultValue = [...default_value]
      newDefaultValue[index].value = value
      handleNodeDataUpdateWithSyncDraft({
        id,
        data: {
          default_value: newDefaultValue,
        },
      })
      return
    }

    handleNodeDataUpdateWithSyncDraft({
      id,
      data: {
        default_value: [
          ...default_value,
          {
            key,
            value,
            type,
          },
        ],
      },
    })
  }, [])

  return {
    handleFormChange,
  }
}

export const useErrorHandle = ({
  id,
}: Pick<Node, 'id' | 'data'>) => {
  const [collapsed, setCollapsed] = useState(true)
  const { handleNodeDataUpdateWithSyncDraft } = useNodeDataUpdate()
  const { handleEdgeDeleteByDeleteBranch } = useEdgesInteractions()

  const handleErrorHandleTypeChange = useCallback((value: ErrorHandleTypeEnum) => {
    if (value === ErrorHandleTypeEnum.none) {
      handleNodeDataUpdateWithSyncDraft({
        id,
        data: {
          error_strategy: undefined,
          default_value: undefined,
        },
      })
      setCollapsed(true)
      handleEdgeDeleteByDeleteBranch(id, ErrorHandleTypeEnum.failBranch)
    }

    if (value === ErrorHandleTypeEnum.failBranch) {
      handleNodeDataUpdateWithSyncDraft({
        id,
        data: {
          error_strategy: value,
          default_value: undefined,
        },
      })
      setCollapsed(false)
    }

    if (value === ErrorHandleTypeEnum.defaultValue) {
      handleNodeDataUpdateWithSyncDraft({
        id,
        data: {
          error_strategy: value,
        },
      })
      setCollapsed(false)
      handleEdgeDeleteByDeleteBranch(id, ErrorHandleTypeEnum.failBranch)
    }
  }, [id, handleNodeDataUpdateWithSyncDraft, handleEdgeDeleteByDeleteBranch])

  return {
    collapsed,
    setCollapsed,
    handleErrorHandleTypeChange,
  }
}
