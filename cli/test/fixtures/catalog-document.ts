import { createHash } from 'node:crypto'
import catalog from './openapi-catalog.json'

export const catalogBody = JSON.stringify(catalog)
export const catalogFingerprint = createHash('sha256').update(catalogBody).digest('hex')
