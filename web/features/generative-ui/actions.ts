import type { ActionEvent } from '@openuidev/react-lang'

export type GenerativeUIAction = {
  type: 'continue_conversation'
  message: string
  formValues?: Record<string, string>
}

/** Project the renderer event into the only interaction supported by Dify's first UI library. */
export function toGenerativeUIAction(event: ActionEvent): GenerativeUIAction | undefined {
  if (event.type !== 'continue_conversation' || !event.humanFriendlyMessage.trim()) return

  const formState: Record<string, unknown> | undefined = event.formState
  const form = event.formName ? formState?.[event.formName] : undefined
  const formValues: Record<string, string> = {}
  if (form && typeof form === 'object') {
    for (const [name, field] of Object.entries(form)) {
      if (
        field &&
        typeof field === 'object' &&
        'value' in field &&
        typeof field.value === 'string'
      ) {
        formValues[name] = field.value
      }
    }
  }

  return {
    type: 'continue_conversation',
    message: event.humanFriendlyMessage,
    ...(event.formName ? { formValues } : {}),
  }
}
