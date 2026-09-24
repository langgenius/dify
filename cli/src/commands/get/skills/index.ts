import { z } from 'zod'
import { Command } from '@/plugins/commands/command'
import { SKILLS } from '@/skills/collection'

const INPUT = z.object({})

export default class SkillsList extends Command<typeof INPUT> {
  static override summary = 'List the skills in the collection'
  static override input = INPUT

  async run() {
    return { skills: SKILLS.map(({ name, description }) => ({ name, description })) }
  }
}
