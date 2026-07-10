import type { Namespace, SelectorParam } from 'i18next'
import type { FileEntity } from '@/app/components/base/file-uploader/types'

export type TextGenerationTranslate = <
  Ns extends Namespace,
  Selector extends SelectorParam<Ns>,
>(
  selector: Selector,
  options: { ns: Ns } & Record<string, unknown>,
) => string

type TaskParam = {
  inputs: Record<string, string | boolean | undefined>
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

export type InputValueTypes
  = | string
    | boolean
    | number
    | string[]
    | Record<string, unknown>
    | FileEntity
    | FileEntity[]
    | undefined

export type TextGenerationRunControl = {
  onStop: () => Promise<void> | void
  isStopping: boolean
}

export type TextGenerationCustomConfig = Record<string, unknown> & {
  remove_webapp_brand?: boolean
  replace_webapp_logo?: string
}
