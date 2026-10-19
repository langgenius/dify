import type { FormInputItem } from '../human-input/shared/types'
import type {
  HumanInputV2DebugMode,
  HumanInputV2MessageTemplate,
  HumanInputV2NodeType,
  HumanInputV2Recipient,
} from './types'
import { useCallback, useLayoutEffect, useRef } from 'react'
import useHumanInputSharedConfig from '../human-input/shared/use-config'

const useHumanInputV2Config = (id: string, payload: HumanInputV2NodeType) => {
  const removedInputsRef = useRef(new Map<string, Map<string, FormInputItem>>())
  // Older drafts can retain input definitions after losing their body placeholders.
  // Restore the existing controls without replacing their options or output identities.
  const missingPlaceholders = payload.inputs
    .map((input) => `{{#$output.${input.output_variable_name}#}}`)
    .filter((placeholder) => !payload.form_content.includes(placeholder))
  const formContent = missingPlaceholders.length
    ? [payload.form_content, ...missingPlaceholders].filter(Boolean).join('\n\n')
    : payload.form_content
  const sharedConfig = useHumanInputSharedConfig(
    id,
    formContent === payload.form_content ? payload : { ...payload, form_content: formContent },
  )
  const { setInputs, ...config } = sharedConfig
  const configRef = useRef(config)
  useLayoutEffect(() => {
    configRef.current = config
  })

  const handleRecipientsChange = (recipients_spec: HumanInputV2Recipient[]) => {
    setInputs({ ...config.inputs, recipients_spec })
  }
  const handleMessageTemplateChange = (message_template: HumanInputV2MessageTemplate) => {
    setInputs({ ...config.inputs, message_template })
  }
  const handleDebugModeChange = (debug_mode: HumanInputV2DebugMode) => {
    setInputs({ ...config.inputs, debug_mode })
  }
  const handleFormContentChange = useCallback(
    (value: string) => {
      const config = configRef.current
      if (config.readOnly) return
      const removedInputs = removedInputsRef.current.get(id) ?? new Map<string, FormInputItem>()
      removedInputsRef.current.set(id, removedInputs)
      const inputs = config.inputs.inputs.filter((input) => {
        if (value.includes(`{{#$output.${input.output_variable_name}#}}`)) {
          removedInputs.delete(input.output_variable_name)
          return true
        }
        removedInputs.set(input.output_variable_name, input)
        return false
      })
      // Lexical undo restores the body token; retain its original field definition too.
      for (const [name, input] of removedInputs) {
        if (
          value.includes(`{{#$output.${name}#}}`) &&
          !inputs.some((current) => current.output_variable_name === name)
        ) {
          inputs.push(input)
          removedInputs.delete(name)
        }
      }
      setInputs({ ...config.inputs, form_content: value, inputs })
    },
    [id, setInputs],
  )
  const handleFormInputsChange = useCallback((inputs: FormInputItem[]) => {
    const config = configRef.current
    if (config.readOnly) return
    // Existing editor blocks can still hold the definitions from before a keyboard deletion.
    config.handleFormInputsChange(
      inputs.filter((input) =>
        config.inputs.form_content.includes(`{{#$output.${input.output_variable_name}#}}`),
      ),
    )
  }, [])

  return {
    ...config,
    handleRecipientsChange,
    handleMessageTemplateChange,
    handleDebugModeChange,
    handleFormContentChange,
    handleFormInputsChange,
  }
}

export default useHumanInputV2Config
