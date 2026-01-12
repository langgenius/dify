type TaskParam = {
  inputs: Record<string, any>
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
