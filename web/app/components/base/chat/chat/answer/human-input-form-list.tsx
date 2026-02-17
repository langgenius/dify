import type { DeliveryMethod, HumanInputNodeType } from '@/app/components/workflow/nodes/human-input/types'
import type { Node } from '@/app/components/workflow/types'
import type { HumanInputFormData } from '@/types/workflow'
import { useMemo } from 'react'
import { DeliveryMethodType } from '@/app/components/workflow/nodes/human-input/types'
import ContentWrapper from './human-input-content/content-wrapper'
import { UnsubmittedHumanInputContent } from './human-input-content/unsubmitted'

type HumanInputFormListProps = {
  humanInputFormDataList: HumanInputFormData[]
  onHumanInputFormSubmit?: (formToken: string, formData: { inputs: Record<string, string>, action: string }) => Promise<void>
  getHumanInputNodeData?: (nodeID: string) => Node<HumanInputNodeType> | undefined
}

const HumanInputFormList = ({
  humanInputFormDataList,
  onHumanInputFormSubmit,
  getHumanInputNodeData,
}: HumanInputFormListProps) => {
  const deliveryMethodsConfig = useMemo((): Record<string, { showEmailTip: boolean, isEmailDebugMode: boolean, showDebugModeTip: boolean }> => {
    if (!humanInputFormDataList.length)
      return {}
    return humanInputFormDataList.reduce((acc, formData) => {
      const deliveryMethodsConfig = getHumanInputNodeData?.(formData.node_id)?.data.delivery_methods || []
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

  const filteredHumanInputFormDataList = humanInputFormDataList.filter(formData => formData.display_in_ui)

  return (
    <div
      className="mt-2 flex flex-col gap-y-2"
      data-testid="human-input-form-list"
    >
      {
        filteredHumanInputFormDataList.map(formData => (
          <div
            key={formData.form_id}
            data-testid="human-input-form-item"
          >
            <ContentWrapper
              nodeTitle={formData.node_title}
            >
              <UnsubmittedHumanInputContent
                formData={formData}
                showEmailTip={!!deliveryMethodsConfig[formData.node_id]?.showEmailTip}
                isEmailDebugMode={!!deliveryMethodsConfig[formData.node_id]?.isEmailDebugMode}
                showDebugModeTip={!!deliveryMethodsConfig[formData.node_id]?.showDebugModeTip}
                onSubmit={onHumanInputFormSubmit}
              />
            </ContentWrapper>
          </div>
        ))
      }
    </div>
  )
}

export default HumanInputFormList
