import type { GraphWorkerInput, GraphWorkerResult } from './graph-worker.ts'
import { Worker } from 'node:worker_threads'

export function analyzeGraphInWorker(input: GraphWorkerInput): Promise<GraphWorkerResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./graph-worker.ts', import.meta.url), { workerData: input })
    let result: GraphWorkerResult | undefined
    worker.once('message', (message: GraphWorkerResult) => {
      result = message
    })
    worker.once('error', reject)
    worker.once('exit', (code) => {
      // Wait for the isolate to exit, not just its message, so its TypeScript
      // program and type state are released before the next environment starts.
      if (code === 0 && result) resolve(result)
      else reject(new Error(`i18n graph analysis worker exited without a result (code ${code})`))
    })
  })
}
