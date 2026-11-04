import type { TranslationAdapter } from './api.ts'
import type { ModuleResolutions } from './compiler.ts'
import { parentPort, workerData } from 'node:worker_threads'
import { checkTranslationGraph, createAnalysisContext } from './graph.ts'

export type GraphWorkerInput = {
  root: string
  modules: ReadonlyMap<string, string>
  resolutions: ModuleResolutions
  adapters: readonly TranslationAdapter[]
}

export type GraphWorkerResult = ReturnType<typeof checkTranslationGraph> & { setupMs: number }

const { root, modules, resolutions, adapters } = workerData as GraphWorkerInput
const started = performance.now()
const context = createAnalysisContext(root, adapters)
const setupMs = performance.now() - started
const result: GraphWorkerResult = {
  ...checkTranslationGraph(root, modules, resolutions, context),
  setupMs,
}
parentPort!.postMessage(result)
