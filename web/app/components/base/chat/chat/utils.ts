import type { InputForm } from './type'

export const processOpeningStatement = (openingStatement: string, inputs: Record<string, any>, inputsForm: InputForm[]) => {
  if (!openingStatement)
    return openingStatement

  return openingStatement.replace(/\{\{([^}]+)\}\}/g, (match, key) => {
    const name = inputs[key]
    if (name) { // has set value
      return name
    }

    const valueObj = inputsForm.find(v => v.variable === key)
    return valueObj ? `{{${valueObj.label}}}` : match
  })
}
