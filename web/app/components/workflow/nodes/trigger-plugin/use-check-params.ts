import { useCallback } from 'react'
import type { PluginTriggerNodeType } from './types'
import { useAllTriggerPlugins } from '@/service/use-triggers'
import { useGetLanguage } from '@/context/i18n'
import { getTriggerCheckParams } from '@/app/components/workflow/utils/trigger'

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
