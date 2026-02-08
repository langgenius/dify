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

// eslint-disable-next-line ts/no-explicit-any
export type InputValueTypes = string | boolean | number | string[] | object | undefined | any
