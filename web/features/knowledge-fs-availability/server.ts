import { consoleClient } from '@/service/console'
import 'server-only'

// Route gates read the signed-in user's deployment availability; failures propagate to the route.
export const getKnowledgeFsFeatures = () => consoleClient.knowledgeFs.features.get()
