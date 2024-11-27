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

type UseGetDefaultValueForms = (params: Pick<Node, 'id' | 'data'>) => DefaultValueForm[]
export const useGetDefaultValueForms: UseGetDefaultValueForms = ({
  data,
}) => {
  const { type, error_strategy } = data

  if (error_strategy === ErrorHandleTypeEnum.defaultValue) {
    if (type === BlockEnum.LLM) {
      return [{
        variable: 'text',
        type: VarType.string,
      }]
    }

    if (type === BlockEnum.HttpRequest) {
      return [
        {
          variable: 'body',
          type: VarType.string,
        },
        {
          variable: 'status_code',
          type: VarType.number,
        },
        {
          variable: 'headers',
          type: VarType.object,
        },
        {
          variable: 'files',
          type: VarType.arrayFile,
        },
      ]
    }

    if (type === BlockEnum.Tool) {
      return [
        {
          variable: 'text',
          type: VarType.string,
        },
        {
          variable: 'files',
          type: VarType.arrayFile,
        },
        {
          variable: 'json',
          type: VarType.arrayObject,
        },
      ]
    }

    if (type === BlockEnum.Code) {
      return [
        {
          variable: 'output',
          type: VarType.object,
        },
      ]
    }
  }

  return []
}

export const useDefaultValue = ({
  id,
  data,
}: Pick<Node, 'id' | 'data'>) => {
  const { handleNodeDataUpdateWithSyncDraft } = useNodeDataUpdate()
  const handleFormChange = useCallback((variable: string, value: any) => {
    handleNodeDataUpdateWithSyncDraft({
      id,
      data: {
        default_value: data.default_value ? { ...data.default_value, [variable]: value } : { [variable]: value },
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
        },
      })
      setCollapsed(true)
    }
    else {
      handleNodeDataUpdateWithSyncDraft({
        id,
        data: {
          error_strategy: value,
        },
      })
      setCollapsed(false)
    }

    if (value !== ErrorHandleTypeEnum.failBranch)
      handleEdgeDeleteByDeleteBranch(id, ErrorHandleTypeEnum.failBranch)
  }, [id, handleNodeDataUpdateWithSyncDraft, handleEdgeDeleteByDeleteBranch])

  return {
    collapsed,
    setCollapsed,
    handleErrorHandleTypeChange,
  }
}
