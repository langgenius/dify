type CommandContext = {
  verbose: boolean
  httpRetry: number | undefined
}

const commandContext: CommandContext = {
  verbose: false,
  httpRetry: undefined,
}

export function setVerbose(verbose: boolean): void {
  commandContext.verbose = verbose
}

export function isVerbose(): boolean {
  return commandContext.verbose
}

export function setHttpRetry(n: number | undefined): void {
  commandContext.httpRetry = n
}

export function getHttpRetry(): number | undefined {
  return commandContext.httpRetry
}
