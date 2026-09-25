import { z } from 'zod'
import { Command } from '@/plugins/commands/command'
import { loadSkills } from '@/skills/collection'
import { FROM_FIELD, openSource } from '@/skills/source'

const INPUT = z.object({ from: FROM_FIELD })

export default class SkillsList extends Command<typeof INPUT> {
  static override summary = 'List the skills in the collection'
  static override input = INPUT

  async run(input: z.infer<typeof INPUT>) {
    const skills = await loadSkills(await openSource(input.from))
    return { skills: skills.map(({ name, description }) => ({ name, description })) }
  }
}
