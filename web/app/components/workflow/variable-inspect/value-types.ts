import type { FileEntity } from '@/app/components/base/file-uploader/types'
import type { PromptTemplateItem } from '@/app/components/workflow/types'
import type { FileResponse } from '@/types/workflow'

export type VarInspectValue
  = string
    | number
    | boolean
    | null
    | Record<string, unknown>
    | Array<string | number | boolean | null | Record<string, unknown>>
    | FileEntity
    | FileEntity[]
    | FileResponse
    | FileResponse[]
    | PromptTemplateItem[]
