import type { DeliveryMethod, HumanInputNodeType } from '../types'
import useHumanInputSharedConfig from '../shared/use-config'

const useConfig = (id: string, payload: HumanInputNodeType) => {
  const sharedConfig = useHumanInputSharedConfig(id, payload)
  const { setInputs, ...config } = sharedConfig

  const handleDeliveryMethodChange = (deliveryMethods: DeliveryMethod[]) => {
    setInputs({
      ...config.inputs,
      delivery_methods: deliveryMethods,
    })
  }

  return {
    ...config,
    handleDeliveryMethodChange,
  }
}

export default useConfig
