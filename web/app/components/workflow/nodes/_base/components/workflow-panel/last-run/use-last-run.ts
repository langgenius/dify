import useOneStepRun from '@/app/components/workflow/nodes/_base/hooks/use-one-step-run'
import type { Params as OneStepRunParams } from '@/app/components/workflow/nodes/_base/hooks/use-one-step-run'
import { useCallback, useRef, useState } from 'react'
import type { PanelExposedType } from '@/types/workflow'
import { TabType } from '../tab'
import { sleep } from '@/utils'
import { useWorkflowStore } from '@/app/components/workflow/store'
import type { Props as FormProps } from '@/app/components/workflow/nodes/_base/components/before-run-form/form'

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

  const [tabType, setTabType] = useState<TabType>(TabType.settings)
  const handleRun = async (data: Record<string, any>) => {
    setTabType(TabType.lastRun)
    callRunApi(data)
    hideSingleRun()
  }

  const handleTabClicked = useCallback((type: TabType) => {
    setTabType(type)
  }, [])
  const hasLastRunData = true // TODO: add disabled logic

  const workflowStore = useWorkflowStore()
  const {
    getInspectVar,
  } = workflowStore.getState()
  const getExistVarValuesInForms = (forms: FormProps[]) => {
    // if (!singleRunParams)
    const valuesArr = forms.map((form) => {
      const values: Record<string, any> = {}
      form.inputs.forEach(({ variable }) => {
        // #nodeId.path1?.path2?...# => [nodeId, path1]
        // TODO: conversation vars and envs
        const selector = variable.slice(1, -1).split('.')
        const [nodeId, varName] = selector.slice(0, 2)
        const inspectVarValue = getInspectVar(nodeId, varName)
        if (inspectVarValue !== undefined) {
          const subPathArr = selector.slice(2)
          if (subPathArr.length > 0) {
            let current = inspectVarValue.value
            let invalid = false
            subPathArr.forEach((subPath) => {
              if (invalid)
                return

              if (current && typeof current === 'object' && subPath in current) {
                current = current[subPath]
                return
              }
              invalid = true
            })
            values[variable] = current
          }
          else {
            values[variable] = inspectVarValue
          }
        }
      })
      return values
    })
    return valuesArr
  }

  const getFilteredExistVarForms = (forms: FormProps[]) => {
    const existVarValuesInForms = getExistVarValuesInForms(forms)

    const res = forms.map((form, i) => {
      const existVarValuesInForm = existVarValuesInForms[i]
      const newForm = { ...form }
      const inputs = form.inputs.filter((input) => {
        return !(input.variable in existVarValuesInForm)
      })
      newForm.inputs = inputs
      return newForm
    }).filter(form => form.inputs.length > 0)
    return res
  }

  return {
    ...oneStepRunRes,
    childPanelRef,
    tabType,
    setTabType: handleTabClicked,
    singleRunParams,
    setSingleRunParams,
    setRunInputData,
    hasLastRunData,
    handleRun,
    getExistVarValuesInForms,
    getFilteredExistVarForms,
  }
}

export default useLastRun
