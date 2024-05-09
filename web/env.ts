import { createEnv } from '@t3-oss/env-nextjs'
import { z } from 'zod'
import { upperCase } from 'lodash-es'

export const env = createEnv({
  /**
   * Specify your server-side environment variables schema here. This way you can ensure the app
   * isn't built with invalid env vars.
   */
  server: {
    NODE_ENV: z
      .enum(['DEVELOPMENT', 'PRODUCTION'])
      .default('DEVELOPMENT'),
  },

  /**
   * Specify your client-side environment variables schema here. This way you can ensure the app
   * isn't built with invalid env vars. To expose them to the client, prefix them with
   * `NEXT_PUBLIC_`.
   */
  client: {
    NEXT_PUBLIC_DEPLOY_ENV: z
      .enum(['DEVELOPMENT', 'PRODUCTION']),
    NEXT_PUBLIC_EDITION: z
      .enum(['SELF_HOSTED', 'CLOUD']),
    NEXT_PUBLIC_API_PREFIX: z.string().optional().default('http://localhost:5001/console/api'),
    NEXT_PUBLIC_PUBLIC_API_PREFIX: z.string().default('http://localhost:5001/api'),
    NEXT_PUBLIC_SENTRY_DSN: z.string().optional(),
    NEXT_PUBLIC_NODE_ENV: z
      .enum(['DEVELOPMENT', 'PRODUCTION'])
      .default('DEVELOPMENT'),
    NEXT_PUBLIC_MAINTENANCE_NOTICE: z.enum(['TRUE']).optional(),
    NEXT_PUBLIC_HIDE_ABOUT_INFO: z.enum(['TRUE']).optional(),
  },

  /**
   * You can't destruct `process.env` as a regular object in the Next.js edge runtimes (e.g.
   * middlewares) or client-side so we need to destruct manually.
   */
  runtimeEnv: {
    NODE_ENV: upperCase(process.env.NODE_ENV),
    NEXT_PUBLIC_NODE_ENV: upperCase(process.env.NODE_ENV),
    NEXT_PUBLIC_DEPLOY_ENV: process.env.NEXT_PUBLIC_DEPLOY_ENV,
    NEXT_PUBLIC_EDITION: process.env.NEXT_PUBLIC_EDITION,
    NEXT_PUBLIC_API_PREFIX: process.env.NEXT_PUBLIC_API_PREFIX,
    NEXT_PUBLIC_PUBLIC_API_PREFIX: process.env.NEXT_PUBLIC_PUBLIC_API_PREFIX,
    NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
    NEXT_PUBLIC_MAINTENANCE_NOTICE: process.env.NEXT_PUBLIC_MAINTENANCE_NOTICE,
    // forward compatibility with the old env var
    NEXT_PUBLIC_HIDE_ABOUT_INFO: process.env.NEXT_PUBLIC_SITE_ABOUT?.toUpperCase() === 'HIDE'
      ? 'TRUE'
      : process.env.NEXT_PUBLIC_HIDE_ABOUT_INFO,
  },
  /**
   * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially
   * useful for Docker builds.
   */
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  /**
   * Makes it so that empty strings are treated as undefined. `SOME_VAR: z.string()` and
   * `SOME_VAR=''` will throw an error.
   */
  emptyStringAsUndefined: true,
})
