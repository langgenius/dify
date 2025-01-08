import produce from 'immer'
import { useCallback } from 'react'
import useNodeCrud from '../_base/hooks/use-node-crud'
import type { SleepNodeType } from './types'

const useConfig = (id: string, payload: SleepNodeType) => {
  const { inputs, setInputs } = useNodeCrud<SleepNodeType>(id, payload)

  const handleSleepTimeChange = useCallback((sleepTimeMs: number | undefined) => {
    const newInputs = produce(inputs, (draft: SleepNodeType) => {
      draft.sleep_time_ms = sleepTimeMs || 1000
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  return {
    inputs,
    handleSleepTimeChange,
  }
}

export default useConfig
