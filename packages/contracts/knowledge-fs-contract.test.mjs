import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  knowledgeFsGeneratedArtifactSha256,
  knowledgeFsSourceOpenapiSha256,
} from './generated/knowledge-fs/metadata.gen'
import { getStreamingOperationIds } from './scripts/knowledge-fs-contract-utils.mjs'

const packageRoot = dirname(fileURLToPath(import.meta.url))

describe('KnowledgeFS contract generation', () => {
  it.each(['200', '2XX'])('detects an SSE response declared with %s', (status) => {
    expect(
      getStreamingOperationIds({
        paths: {
          '/tasks/{id}/events': {
            get: {
              operationId: 'streamTaskEvents',
              responses: {
                [status]: {
                  content: {
                    'text/event-stream': {},
                  },
                },
              },
            },
          },
        },
      }),
    ).toEqual(['streamTaskEvents'])
  })

  it('matches the pinned source contract and committed generated artifacts', async () => {
    const lock = JSON.parse(
      await readFile(join(packageRoot, '../../api/knowledge-fs-contract.lock.json'), 'utf8'),
    )

    expect(knowledgeFsSourceOpenapiSha256).toBe(lock.openapiSha256)
    for (const [fileName, expectedSha256] of Object.entries(knowledgeFsGeneratedArtifactSha256)) {
      const content = await readFile(join(packageRoot, 'generated/knowledge-fs', fileName))
      expect(createHash('sha256').update(content).digest('hex'), fileName).toBe(expectedSha256)
    }
  })
})
