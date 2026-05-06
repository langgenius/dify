export const WorkflowCommand = {
  ToggleCanvasMaximize: 'workflow:toggle-canvas-maximize',
} as const

type WorkflowCommandType = typeof WorkflowCommand[keyof typeof WorkflowCommand]

const workflowCommandTarget = new EventTarget()

export const emitWorkflowCommand = (command: WorkflowCommandType) => {
  workflowCommandTarget.dispatchEvent(new Event(command))
}

export const subscribeWorkflowCommand = (
  command: WorkflowCommandType,
  listener: () => void,
) => {
  workflowCommandTarget.addEventListener(command, listener)
  return () => workflowCommandTarget.removeEventListener(command, listener)
}
