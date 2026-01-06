import type { CommonNodeType } from '@/app/components/workflow/types'

export type CommandNodeType = CommonNodeType & {
  working_directory: string
  command: string
}
