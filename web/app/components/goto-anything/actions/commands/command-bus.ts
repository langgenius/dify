export type CommandHandler = (args?: Record<string, any>) => void | Promise<void>

const handlers = new Map<string, CommandHandler>()

const registerCommand = (name: string, handler: CommandHandler) => {
  handlers.set(name, handler)
}

const unregisterCommand = (name: string) => {
  handlers.delete(name)
}

export const executeCommand = async (name: string, args?: Record<string, any>) => {
  const handler = handlers.get(name)
  if (!handler)
    return
  await handler(args)
}

export const registerCommands = (map: Record<string, CommandHandler>) => {
  Object.entries(map).forEach(([name, handler]) => registerCommand(name, handler))
}

export const unregisterCommands = (names: string[]) => {
  names.forEach(unregisterCommand)
}
