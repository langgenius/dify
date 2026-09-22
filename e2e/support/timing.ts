import { appendFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const logDirectory = fileURLToPath(new URL('../.logs/', import.meta.url))

// Each process has its own JSONL file. Child service processes and Cucumber
// workers can report independently without racing a shared read/modify/write.
export const recordTiming = (phase: string, durationMs: number, status: string) => {
  const entry = {
    phase,
    durationMs: Math.round(durationMs),
    status,
    finishedAt: new Date().toISOString(),
    pid: process.pid,
  }
  console.warn(`[e2e:timing] ${JSON.stringify(entry)}`)
  try {
    mkdirSync(logDirectory, { recursive: true })
    appendFileSync(`${logDirectory}timings-${process.pid}.log`, `${JSON.stringify(entry)}\n`)
    if (process.env.GITHUB_STEP_SUMMARY) {
      const label = phase.replace(/[\r\n`<>]/g, ' ')
      appendFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        `- \`${label}\`: ${(durationMs / 1000).toFixed(2)}s (${status})\n`,
      )
    }
  } catch (error) {
    // Diagnostics must not change the test result or hide the original error.
    console.warn('[e2e:timing] Could not persist timing', error)
  }
}

export const measurePhase = async <T>(
  phase: string,
  operation: () => Promise<T>,
  succeeded: (result: T) => boolean = () => true,
): Promise<T> => {
  const started = performance.now()
  let status = 'failed'
  try {
    const result = await operation()
    status = succeeded(result) ? 'passed' : 'failed'
    return result
  } finally {
    recordTiming(phase, performance.now() - started, status)
  }
}
