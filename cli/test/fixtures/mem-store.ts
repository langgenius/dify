import type { TokenStore } from '../../src/store/token-store.js'

// In-memory TokenStore for tests; mirrors keyring semantics (empty string = missing).
export class MemStore implements TokenStore {
  readonly entries: Map<string, string>

  // Seed keys use the composite "<host> <email>" form, e.g. { 'h1 a@x': 'dfoa_a' }.
  constructor(seed: Record<string, string> = {}) {
    this.entries = new Map(Object.entries(seed))
  }

  private k(host: string, email: string): string {
    return `${host} ${email}`
  }

  async read(host: string, email: string): Promise<string> {
    return this.entries.get(this.k(host, email)) ?? ''
  }

  async write(host: string, email: string, bearer: string): Promise<void> {
    this.entries.set(this.k(host, email), bearer)
  }

  async remove(host: string, email: string): Promise<void> {
    this.entries.delete(this.k(host, email))
  }
}
