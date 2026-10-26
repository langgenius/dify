import assert from 'node:assert/strict'
// oxlint-disable-next-line vitest/no-import-node-test -- run with node --test, not vitest
import { test } from 'node:test'
import { insertFrontmatter, latestStableTag, skillFields } from './lib.ts'

test('latestStableTag picks the highest x.y.z, numerically', () => {
  assert.equal(
    latestStableTag([
      '1.9.0',
      '1.18.0',
      '2.0.0-beta.2',
      'v0.8.3-fix1',
      'openapi-catalog-pre-reset',
      '1.17.1',
    ]),
    '1.18.0',
  )
})
test('latestStableTag throws when no stable tag exists', () => {
  assert.throws(() => latestStableTag(['2.0.0-beta.1', 'foo']), /no stable release tag/)
})

const META = {
  skill: 'difyctl',
  fields: {
    display_name: 'Dify',
    display_name_en: 'Dify',
    description_zh: '中文',
    description_en: 'en',
    author: 'LangGenius',
  },
}
test('skillFields adds version from the connector', () => {
  assert.equal(skillFields(META, '1.0.0').version, '1.0.0')
})
test('skillFields throws on a missing required field', () => {
  const { display_name, display_name_en, description_zh, description_en } = META.fields
  const fields = { display_name, display_name_en, description_zh, description_en }
  assert.throws(() => skillFields({ ...META, fields }, '1.0.0'), /author/)
})
for (const owned of ['version', 'name', 'description']) {
  test(`skillFields rejects ${owned} in skill-meta`, () => {
    assert.throws(
      () => skillFields({ ...META, fields: { ...META.fields, [owned]: 'x' } }, '1.0.0'),
      new RegExp(owned),
    )
  })
}

const SKILL = "---\nname: difyctl\ndescription: 'Operate a Dify server'\n---\n\n# difyctl\n"
test('insertFrontmatter appends quoted fields before the closing ---', () => {
  assert.equal(
    insertFrontmatter(SKILL, {
      display_name_en: 'Dify: run "apps" #1',
      examples_zh: ['@列出应用', '运行'],
    }),
    "---\nname: difyctl\ndescription: 'Operate a Dify server'\n" +
      'display_name_en: "Dify: run \\"apps\\" #1"\n' +
      'examples_zh:\n  - "@列出应用"\n  - "运行"\n' +
      '---\n\n# difyctl\n',
  )
})
test('insertFrontmatter throws when the source already has the key', () => {
  assert.throws(() => insertFrontmatter(SKILL, { name: 'x' }), /name/)
})
test('insertFrontmatter throws without a header', () => {
  assert.throws(() => insertFrontmatter('# difyctl\n', { author: 'x' }), /frontmatter/)
})
test('insertFrontmatter throws on an unclosed header', () => {
  assert.throws(
    () => insertFrontmatter('---\nname: difyctl\n# difyctl\n', { author: 'x' }),
    /frontmatter/,
  )
})
