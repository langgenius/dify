import { createSerializer, parseAsStringLiteral } from 'nuqs'

export const tracingSearchParams = {
  tracing: parseAsStringLiteral(['configure']),
}

export const serializeTracingSearchParams = createSerializer(tracingSearchParams)
