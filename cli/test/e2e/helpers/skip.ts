import { describe, it } from 'vitest'

export function optionalDescribe(condition: boolean) {
  return condition ? describe : describe.skip
}

export function optionalIt(condition: boolean) {
  return condition ? it : it.skip
}
