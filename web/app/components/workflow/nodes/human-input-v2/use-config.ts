import type {
  HumanInputV2DebugMode,
  HumanInputV2MessageTemplate,
  HumanInputV2NodeType,
  HumanInputV2Recipient,
} from './types'
import useHumanInputSharedConfig from '../human-input/shared/use-config'

const useHumanInputV2Config = (id: string, payload: HumanInputV2NodeType) => {
  const sharedConfig = useHumanInputSharedConfig(id, payload)
  const { setInputs, ...config } = sharedConfig

  const handleRecipientsChange = (recpients_spec: HumanInputV2Recipient[]) => {
    setInputs({ ...config.inputs, recpients_spec })
  }
  const handleMessageTemplateChange = (message_template: HumanInputV2MessageTemplate) => {
    setInputs({ ...config.inputs, message_template })
  }
  const handleDebugModeChange = (debug_mode: HumanInputV2DebugMode) => {
    setInputs({ ...config.inputs, debug_mode })
  }

  return {
    ...config,
    handleRecipientsChange,
    handleMessageTemplateChange,
    handleDebugModeChange,
  }
}

export default useHumanInputV2Config
