import type { DeliveryMethod } from '@/app/components/workflow/nodes/human-input/types'
import type { HumanInputFormData } from '@/types/workflow'
import { useCallback, useMemo } from 'react'
import { useStoreApi } from 'reactflow'
import ContentWrapper from '@/app/components/base/chat/chat/answer/human-input-content/content-wrapper'
import { UnsubmittedHumanInputContent } from '@/app/components/base/chat/chat/answer/human-input-content/unsubmitted'
import { CUSTOM_NODE } from '@/app/components/workflow/constants'
import { DeliveryMethodType } from '@/app/components/workflow/nodes/human-input/types'

type HumanInputFormListProps = {
  humanInputFormDataList: HumanInputFormData[]
  onHumanInputFormSubmit?: (formToken: string, formData: any) => Promise<void>
}

const HumanInputFormList = ({
  humanInputFormDataList,
  onHumanInputFormSubmit,
}: HumanInputFormListProps) => {
  const store = useStoreApi()

  const getHumanInputNodeData = useCallback((nodeID: string) => {
    const {
      getNodes,
    } = store.getState()
    const nodes = getNodes().filter(node => node.type === CUSTOM_NODE)
    const node = nodes.find(n => n.id === nodeID)
    return node
  }, [store])

  const deliveryMethodsConfig = useMemo((): Record<string, { showEmailTip: boolean, isEmailDebugMode: boolean, showDebugModeTip: boolean }> => {
    if (!humanInputFormDataList.length)
      return {}
    return humanInputFormDataList.reduce((acc, formData) => {
      const deliveryMethodsConfig = getHumanInputNodeData(formData.node_id)?.data.delivery_methods || []
      if (!deliveryMethodsConfig.length) {
        acc[formData.node_id] = {
          showEmailTip: false,
          isEmailDebugMode: false,
          showDebugModeTip: false,
        }
        return acc
      }
      const isWebappEnabled = deliveryMethodsConfig.some((method: DeliveryMethod) => method.type === DeliveryMethodType.WebApp && method.enabled)
      const isEmailEnabled = deliveryMethodsConfig.some((method: DeliveryMethod) => method.type === DeliveryMethodType.Email && method.enabled)
      const isEmailDebugMode = deliveryMethodsConfig.some((method: DeliveryMethod) => method.type === DeliveryMethodType.Email && method.config?.debug_mode)
      acc[formData.node_id] = {
        showEmailTip: isEmailEnabled,
        isEmailDebugMode,
        showDebugModeTip: !isWebappEnabled,
      }
      return acc
    }, {} as Record<string, { showEmailTip: boolean, isEmailDebugMode: boolean, showDebugModeTip: boolean }>)
  }, [getHumanInputNodeData, humanInputFormDataList])

  const filteredHumanInputFormDataList = useMemo(() => {
    return humanInputFormDataList.filter(formData => formData.display_in_ui)
  }, [humanInputFormDataList])

  return (
    <div className="flex flex-col gap-y-3">
      {
        filteredHumanInputFormDataList.map(formData => (
          <ContentWrapper
            key={formData.node_id}
            nodeTitle={formData.node_title}
            className="bg-components-panel-bg"
          >
            <UnsubmittedHumanInputContent
              key={formData.node_id}
              formData={formData}
              showEmailTip={!!deliveryMethodsConfig[formData.node_id]?.showEmailTip}
              isEmailDebugMode={!!deliveryMethodsConfig[formData.node_id]?.isEmailDebugMode}
              showDebugModeTip={!!deliveryMethodsConfig[formData.node_id]?.showDebugModeTip}
              onSubmit={onHumanInputFormSubmit}
            />
          </ContentWrapper>
        ))
      }
    </div>
  )
}

export default HumanInputFormList
