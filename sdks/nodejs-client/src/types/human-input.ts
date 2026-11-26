import type { JsonObject } from './common'

export type HumanInputValueSource<T> = {
  type: 'constant' | 'variable'
  /** @deprecated Use the resolved value supplied by the server. */
  selector: string[]
  value: T
}

type HumanInputFileConstraints = {
  output_variable_name: string
  allowed_file_types: string[]
  allowed_file_extensions: string[]
  allowed_file_upload_methods: string[]
}

export type HumanInputField =
  | {
    type: 'paragraph'
    output_variable_name: string
    default: HumanInputValueSource<string> | null
  }
  | {
    type: 'select'
    output_variable_name: string
    option_source: HumanInputValueSource<string[]>
  }
  | (HumanInputFileConstraints & { type: 'file' })
  | (HumanInputFileConstraints & { type: 'file-list', number_limits: number })

export type HumanInputForm = {
  form_content: string
  inputs: HumanInputField[]
  resolved_default_values: Record<string, string>
  user_actions: Array<{
    id: string
    title: string
    button_style: 'primary' | 'default' | 'accent' | 'ghost'
  }>
  expiration_time: number | null
}

export type HumanInputFormSubmission = {
  user: string
  action: string
  inputs: JsonObject
}

export type WorkflowEventsOptions = {
  includeStateSnapshot?: boolean
  continueOnPause?: boolean
}
