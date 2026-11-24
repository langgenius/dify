import type { PluginTriggerNodeType } from './types'
import { useQuery } from '@tanstack/react-query'
import { useCallback } from 'react'
import { getTriggerCheckParams } from '@/app/components/workflow/utils/trigger'
import { useGetLanguage } from '@/context/i18n'
import { allTriggerPluginsQueryOptions } from '@/service/trigger-queries'

type Params = {
  id: string
  payload: PluginTriggerNodeType
}

const useGetDataForCheckMore = ({ payload }: Params) => {
  const { data: triggerPlugins } = useQuery(allTriggerPluginsQueryOptions())
  const language = useGetLanguage()

  const getData = useCallback(() => {
    return getTriggerCheckParams(payload, triggerPlugins, language)
  }, [payload, triggerPlugins, language])

  return {
    getData,
  }
}

export default useGetDataForCheckMore
