type CommandContext = {
  verbose: boolean
}

const commandContext: CommandContext = {
  verbose: false,
}

export function setVerbose(verbose: boolean): void {
  commandContext.verbose = verbose
}

export function isVerbose(): boolean {
  return commandContext.verbose
}
