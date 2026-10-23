import type { RuntimeConfig } from '@dify/openapi-inference'
import type { ConsoleClientContext } from './index'
import { reportClientError } from '../client-error'
import { createConsoleInferenceTransport } from './inference-transport'

export type Context = ConsoleClientContext

const runtime: RuntimeConfig = {
  createClient: ({ context }) => createConsoleInferenceTransport(context),
  queryKeyPrefix: ['console'],
  onError: reportClientError,
}

export default runtime
