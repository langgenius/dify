import type { DifyWorld } from '../../support/world'
import { Given, Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'
import { voiceInputTestMaterial } from '../../../support/test-materials'
import { createConfiguredTestAgent } from '../../agent-v2/support/agent'
import {
  createAgentSoulConfigWithSpeechToText,
  normalAgentSoulConfig,
} from '../../agent-v2/support/agent-soul'
import { getCurrentAgentId } from './configure-helpers'

const getAgentInput = (world: DifyWorld) =>
  world.getPage().getByPlaceholder('Describe what your agent should do')

const escapeRegExp = (value: string) => value.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')

Given(
  'an Agent v2 test agent with speech-to-text enabled has been created via API',
  async function (this: DifyWorld) {
    if (!this.agentBuilder.preflight.speechToTextModel) {
      throw new Error(
        'Create a speech-to-text Agent v2 test agent after the default Speech-to-Text model preflight.',
      )
    }

    const agent = await createConfiguredTestAgent({
      agentSoul: createAgentSoulConfigWithSpeechToText(normalAgentSoulConfig),
    })
    this.createdAgentIds.push(agent.id)
    this.lastCreatedAgentName = agent.name
    this.lastCreatedAgentRole = agent.role ?? undefined
  },
)

When('I start Agent v2 voice input', async function (this: DifyWorld) {
  const page = this.getPage()

  await expect(getAgentInput(this)).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: 'Voice input' }).click()
  await expect(page.getByText('Speak now...')).toBeVisible({ timeout: 30_000 })
})

When(
  'I stop Agent v2 voice input after the fixture speech has played',
  async function (this: DifyWorld) {
    const page = this.getPage()
    const agentId = getCurrentAgentId(this)

    await expect(page.getByTestId('voice-input-timer')).toHaveText(
      voiceInputTestMaterial.recordingDuration,
      { timeout: 15_000 },
    )

    const responsePromise = page.waitForResponse(response => (
      response.request().method() === 'POST'
      && new URL(response.url()).pathname === `/console/api/agent/${agentId}/audio-to-text`
    ))
    await page.getByTestId('voice-input-stop').click()
    const response = await responsePromise
    const request = response.request()

    this.agentBuilder.speechToText.request = {
      contentType: request.headers()['content-type'] ?? '',
      path: new URL(response.url()).pathname,
      status: response.status(),
    }
  },
)

Then('the Agent v2 speech-to-text request should succeed', async function (this: DifyWorld) {
  const request = this.agentBuilder.speechToText.request
  if (!request)
    throw new Error('No Agent v2 speech-to-text request was captured.')

  expect(request).toEqual(expect.objectContaining({
    contentType: expect.stringContaining('multipart/form-data'),
    path: `/console/api/agent/${getCurrentAgentId(this)}/audio-to-text`,
    status: 200,
  }))
})

Then(
  'the transcribed fixture phrase {string} should appear in the Agent v2 input',
  async function (this: DifyWorld, expectedPhrase: string) {
    const phrasePattern = new RegExp(
      expectedPhrase.trim().split(/\s+/).map(escapeRegExp).join('\\s+'),
      'i',
    )

    await expect(getAgentInput(this)).toHaveValue(phrasePattern, { timeout: 60_000 })
  },
)
