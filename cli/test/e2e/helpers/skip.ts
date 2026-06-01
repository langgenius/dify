import { describe, it } from 'vitest'

export function optionalDescribe(condition: boolean): typeof describe {
  return condition ? describe : describe.skip
}

export function optionalIt(condition: boolean): typeof it {
  return condition ? it : it.skip
}
