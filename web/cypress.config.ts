import { addCucumberPreprocessorPlugin } from '@badeball/cypress-cucumber-preprocessor'
import { createEsbuildPlugin } from '@badeball/cypress-cucumber-preprocessor/esbuild'
import createBundler from '@bahmutov/cypress-esbuild-preprocessor'
import { defineConfig } from 'cypress'
import { PostgresClient } from './cypress/support/db'

export default defineConfig({
  e2e: {
    baseUrl: 'http://localhost:3000',
    specPattern: '**/*.feature',
    video: true,
    env: {
      SLOW_DOWN: false,
    },
    // it might take a while for nextjs to compile the page on first visit
    defaultCommandTimeout: Number(process.env.CYPRESS_COMMAND_TIMEOUT) || 10000,
    async setupNodeEvents(
      on: Cypress.PluginEvents,
      config: Cypress.PluginConfigOptions,
    ): Promise<Cypress.PluginConfigOptions> {
      await addCucumberPreprocessorPlugin(on, config)

      on(
        'file:preprocessor',
        createBundler({
          plugins: [createEsbuildPlugin(config)],
        }),
      )

      const dbInstance = new PostgresClient()

      on('task', {
        runQuery: async ({ query, params }: { query: string; params?: any[] }) => {
          // This will only create a new connection if it's not already connected
          await dbInstance.connect({
            user: 'postgres',
            host: 'localhost',
            database: 'dify',
            password: 'difyai123456',
            port: 54321,
          })
          return dbInstance.query(query, params)
        },
      })

      on('after:run', async () => {
        // This will be called once after all tests
        await dbInstance.close()
      })

      return config
    },
  },
})
