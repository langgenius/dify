import { consoleRouterContract as generatedConsoleRouterContract } from './generated/api/console/router.gen'
import { contract as knowledgeFsContract } from './generated/knowledge-fs/orpc.gen'

export const consoleRouterContract = {
  ...generatedConsoleRouterContract,
  knowledgeFs: knowledgeFsContract,
}
