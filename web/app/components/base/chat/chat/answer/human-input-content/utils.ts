import { UserActionButtonType } from '@/app/components/workflow/nodes/human-input/types'
import type { GeneratedFormInputItem } from '@/app/components/workflow/nodes/human-input/types'

export const getButtonStyle = (style: UserActionButtonType) => {
  if (style === UserActionButtonType.Primary)
    return 'primary'
  if (style === UserActionButtonType.Default)
    return 'secondary'
  if (style === UserActionButtonType.Accent)
    return 'secondary-accent'
  if (style === UserActionButtonType.Ghost)
    return 'ghost'
}

export const splitByOutputVar = (content: string): string[] => {
  const outputVarRegex = /({{#\$output\.[^#]+#}})/g
  const parts = content.split(outputVarRegex)
  return parts.filter(part => part.length > 0)
}

export const initializeInputs = (formInputs: GeneratedFormInputItem[]) => {
  const initialInputs: Record<string, any> = {}
  formInputs.forEach((item) => {
    if (item.type === 'text-input' || item.type === 'paragraph')
      initialInputs[item.output_variable_name] = ''
    else
      initialInputs[item.output_variable_name] = undefined
  })
  return initialInputs
}
