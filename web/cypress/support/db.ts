import type { ClientConfig, QueryResult } from 'pg'
import { Client } from 'pg'

export class PostgresClient {
  private client: Client | null = null

  public async connect(config: ClientConfig) {
    console.debug('Connecting to database...')
    if (!this.client) {
      this.client = new Client(config)
      await this.client.connect()
    }
  }

  public async query(queryText: string, params?: any[]): Promise<QueryResult<any>> {
    if (!this.client)
      throw new Error('Database not connected. Call connect() first.')

    return this.client.query(queryText, params)
  }

  public async close() {
    console.debug('Closing database connection...')
    if (this.client) {
      await this.client.end()
      this.client = null
    }
  }
}
