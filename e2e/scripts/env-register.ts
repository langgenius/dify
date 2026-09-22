import { loadE2eEnv, validateE2eEnv } from './env'

// Entry points import this before test-env.ts so e2e/.env.local can affect base URLs and runner flags.
loadE2eEnv()
validateE2eEnv()
