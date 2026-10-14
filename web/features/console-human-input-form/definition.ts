import type { ConsoleHumanInputV2FormDefinitionResponse } from '@dify/contracts/api/console/form/types.gen'
import type { HumanInputFormDefinition } from '@/features/human-input-form/types'
import { zConsoleHumanInputV2FormDefinitionResponse } from '@dify/contracts/api/console/form/zod.gen'
import { normalizeHumanInputFormInput } from '@/app/components/workflow/nodes/human-input/shared/types'

export const normalizeConsoleFormDefinition = (
  response: ConsoleHumanInputV2FormDefinitionResponse,
): HumanInputFormDefinition => {
  const { resolved_form: form, expiration_time } =
    zConsoleHumanInputV2FormDefinitionResponse.parse(response)
  const inputs: HumanInputFormDefinition['inputs'] = []
  const resolvedDefaultValues: HumanInputFormDefinition['resolvedDefaultValues'] = {}
  const inputNames = new Set<string>()

  const content = form.parts.map((part) => {
    if (part.type === 'markdown_fragment') return part.text

    const name = part.output_variable_name
    if (!inputNames.has(name)) {
      inputNames.add(name)
      switch (part.type) {
        case 'paragraph_input':
          inputs.push(
            normalizeHumanInputFormInput({
              type: 'paragraph',
              output_variable_name: name,
              default:
                part.default_value === null
                  ? null
                  : { type: 'constant', value: part.default_value },
            }),
          )
          if (part.default_value !== null) resolvedDefaultValues[name] = part.default_value
          break
        case 'select_input':
          inputs.push(
            normalizeHumanInputFormInput({
              type: 'select',
              output_variable_name: name,
              option_source: { type: 'constant', value: part.options },
            }),
          )
          if (part.default_value !== null) resolvedDefaultValues[name] = part.default_value
          break
        case 'file_input':
          inputs.push(normalizeHumanInputFormInput({ ...part, type: 'file' }))
          break
        case 'file_list_input':
          inputs.push(normalizeHumanInputFormInput({ ...part, type: 'file-list' }))
          break
      }
    }
    return `{{#$output.${name}#}}`
  })

  return {
    formContent: content.join(''),
    inputs,
    resolvedDefaultValues,
    actions: form.actions,
    expirationTime: expiration_time,
  }
}
