'use client'

// Polyfill for Array.prototype.toSpliced (ES2023, Chrome 110+)
if (!Array.prototype.toSpliced) {
  // eslint-disable-next-line no-extend-native
  Array.prototype.toSpliced = function <T>(this: T[], start: number, deleteCount?: number, ...items: T[]): T[] {
    const copy = this.slice()
    // When deleteCount is undefined (omitted), delete to end; otherwise let splice handle coercion
    if (deleteCount === undefined)
      copy.splice(start, copy.length - start, ...items)
    else
      copy.splice(start, deleteCount, ...items)
    return copy
  }
}

class StorageMock {
  data: Record<string, string>

  constructor() {
    this.data = {} as Record<string, string>
  }

  setItem(name: string, value: string) {
    this.data[name] = value
  }

  getItem(name: string) {
    return this.data[name] || null
  }

  removeItem(name: string) {
    delete this.data[name]
  }

  clear() {
    this.data = {}
  }
}

let localStorage, sessionStorage

try {
  localStorage = globalThis.localStorage
  sessionStorage = globalThis.sessionStorage
}
catch {
  localStorage = new StorageMock()
  sessionStorage = new StorageMock()
}

Object.defineProperty(globalThis, 'localStorage', {
  value: localStorage,
})

Object.defineProperty(globalThis, 'sessionStorage', {
  value: sessionStorage,
})

const BrowserInitializer = ({
  children,
}: { children: React.ReactElement }) => {
  return children
}

export default BrowserInitializer
