import useOneStepRun from '@/app/components/workflow/nodes/_base/hooks/use-one-step-run'
import type { Params as OneStepRunParams } from '@/app/components/workflow/nodes/_base/hooks/use-one-step-run'
import { useCallback, useRef, useState } from 'react'
import type { PanelExposedType } from '@/types/workflow'
import { TabType } from '../tab'
import { sleep } from '@/utils'

type Params<T> = OneStepRunParams<T>
const useLastRun = <T>({
  ...oneStepRunParams
}: Params<T>) => {
  const childPanelRef = useRef<PanelExposedType>(null)

  const oneStepRunRes = useOneStepRun(oneStepRunParams)
  const {
    hideSingleRun,
    handleRun: callRunApi,
    setRunInputData: doSetRunInputData,
  } = oneStepRunRes

  const [singleRunParams, setSingleRunParams] = useState<PanelExposedType['singleRunParams'] | undefined>(undefined)

  const setRunInputData = useCallback(async (data: Record<string, any>) => {
    doSetRunInputData(data)
    // console.log(childPanelRef.current?.singleRunParams)
    await sleep(0) // wait for childPanelRef.current?.singleRunParams refresh
    setSingleRunParams(childPanelRef.current?.singleRunParams)
  }, [doSetRunInputData])

  const [isDataFromHistory, setIsDataFromHistory] = useState(true)
  const [tabType, setTabType] = useState<TabType>(TabType.settings)
  const handleRun = async (data: Record<string, any>) => {
    setIsDataFromHistory(false)
    setTabType(TabType.lastRun)
    callRunApi(data)
    hideSingleRun()
  }

  const handleTabClicked = useCallback((type: TabType) => {
    setTabType(type)
    setIsDataFromHistory(true)
  }, [])
  const hasLastRunData = true // TODO: add disabled logic

  return {
    ...oneStepRunRes,
    childPanelRef,
    tabType,
    setTabType: handleTabClicked,
    singleRunParams,
    setSingleRunParams,
    setRunInputData,
    hasLastRunData,
    isDataFromHistory,
    handleRun,
  }
}

export default useLastRun
