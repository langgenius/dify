import type { SourceAppPickerValue } from '../ui/source-app-picker-value'

export type ReleaseSourceMode = 'sourceApp' | 'dsl'

export type CreateReleaseFormValues = {
  releaseSourceMode: ReleaseSourceMode
  sourceApp?: SourceAppPickerValue
  dslFile?: File
  releaseName: string
  releaseDescription: string
}

export const DEFAULT_CREATE_RELEASE_FORM_VALUES: CreateReleaseFormValues = {
  releaseSourceMode: 'sourceApp',
  sourceApp: undefined,
  dslFile: undefined,
  releaseName: '',
  releaseDescription: '',
}
