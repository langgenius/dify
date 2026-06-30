import { agent } from '@dify/contracts/api/console/agent/orpc.gen'
import { agentDriveContracts } from './agent-drive'

export const agentRouterContract = {
  ...agent,
  byAgentId: {
    ...agent.byAgentId,
    drive: {
      ...agent.byAgentId.drive,
      ...agentDriveContracts.byAgentId.drive,
    },
  },
}
