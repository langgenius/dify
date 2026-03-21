import type { DefaultValueForm } from './types'
import type {
  CommonNodeType,
} from '@/app/components/workflow/types'
import {
  useCallback,
  useMemo,
  useState,
} from 'react'
import {
  useEdgesInteractions,
  useNodeDataUpdate,
} from '@/app/components/workflow/hooks'
import { ErrorHandleTypeEnum } from './types'
import { getDefaultValue } from './utils'

export const useDefaultValue = (
  id: string,
) => {
  const { handleNodeDataUpdateWithSyncDraft } = useNodeDataUpdate()
  const handleFormChange = useCallback((
    {
      key,
      value,
      type,
    }: DefaultValueForm,
    data: CommonNodeType,
  ) => {
    const default_value = data.default_value || []
    const index = default_value.findIndex(form => form.key === key)

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
  }, [handleNodeDataUpdateWithSyncDraft, id])

  return {
    handleFormChange,
  }
}

export const useErrorHandle = (
  id: string,
  data: CommonNodeType,
) => {
  const initCollapsed = useMemo(() => {
    if (data.error_strategy === ErrorHandleTypeEnum.none)
      return true

    return false
  }, [data.error_strategy])
  const [collapsed, setCollapsed] = useState(initCollapsed)
  const { handleNodeDataUpdateWithSyncDraft } = useNodeDataUpdate()
  const { handleEdgeDeleteByDeleteBranch } = useEdgesInteractions()

  const handleErrorHandleTypeChange = useCallback((value: ErrorHandleTypeEnum, data: CommonNodeType) => {
    if (data.error_strategy === value)
      return

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
          default_value: getDefaultValue(data),
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
