import type { ConsoleHumanInputFormDefinitionResponse } from '@dify/contracts/api/console/form/types.gen'
import type { HumanInputFormDefinition } from '@/features/human-input-form/types'
import { zFormInputConfig, zUserActionConfig } from '@dify/contracts/api/console/apps/zod.gen'
import { z } from 'zod'
import { normalizeHumanInputFormInput } from '@/app/components/workflow/nodes/human-input/shared/types'

// The Console endpoint exposes an unstructured generated response. Validate it
// here with the existing field/action contracts before rendering the form.
const definitionSchema = z.object({
  rendered_content: z.string(),
  inputs: z.array(zFormInputConfig),
  user_actions: z.array(zUserActionConfig),
  default_values: z.record(z.string(), z.unknown()).default({}),
  expiration_time: z.number(),
})

export const normalizeConsoleFormDefinition = (
  response: ConsoleHumanInputFormDefinitionResponse,
): HumanInputFormDefinition => {
  const definition = definitionSchema.parse(response)

  return {
    formContent: definition.rendered_content,
    inputs: definition.inputs.map(normalizeHumanInputFormInput),
    actions: definition.user_actions.map((action) => ({
      ...action,
      button_style: action.button_style ?? 'default',
    })),
    resolvedDefaultValues: Object.fromEntries(
      Object.entries(definition.default_values).map(([name, value]) => [
        name,
        typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value),
      ]),
    ),
    expirationTime: definition.expiration_time,
  }
}
