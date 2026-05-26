import type { PluginTriggerNodeType } from '@/app/components/workflow/nodes/trigger-plugin/types'
import { useCallback } from 'react'
import { getTriggerCheckParams } from '@/app/components/workflow/utils/trigger'
import { useGetLanguage } from '@/context/i18n'
import { useAllTriggerPlugins } from '@/service/use-triggers'

type Params = {
  id: string
  payload: PluginTriggerNodeType
}

const useGetDataForCheckMore = ({
  payload,
}: Params) => {
  const { data: triggerPlugins } = useAllTriggerPlugins()
  const language = useGetLanguage()

  const getData = useCallback(() => {
    return getTriggerCheckParams(payload, triggerPlugins, language)
  }, [payload, triggerPlugins, language])

  return {
    getData,
  }
}

export default useGetDataForCheckMore
