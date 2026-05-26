export function getEnv(name: string): string | undefined {
  return process.env[name]
}

export function processExit(code: number): never {
  return process.exit(code) as never
}

export function io() {
  return {
    out: process.stdout,
    err: process.stderr,
    in: process.stdin,
    isOutTTY: Boolean(process.stdout.isTTY),
    isErrTTY: Boolean(process.stderr.isTTY),
  }
}

export function handle(sig: string, handler: ()=>void) {
  process.once('SIGINT', handler)
}

export function platform(): string {
  return process.platform
}

export function pid(): number {
  return Number(process.pid)
}