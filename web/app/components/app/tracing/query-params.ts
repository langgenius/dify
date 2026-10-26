import { parseAsStringLiteral } from 'nuqs'

export const tracingQueryParamName = 'tracing'

export const tracingQueryParser = parseAsStringLiteral(['configure'])
