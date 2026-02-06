import type { FileEntity } from '@/app/components/base/file-uploader/types'

export type InputValueTypes = string | boolean | number | string[] | FileEntity | FileEntity[] | Record<string, unknown> | undefined

export type TaskParam = {
  inputs: Record<string, string | undefined>
}

export type Task = {
  id: number
  status: TaskStatus
  params: TaskParam
}

export enum TaskStatus {
  pending = 'pending',
  running = 'running',
  completed = 'completed',
  failed = 'failed',
}
