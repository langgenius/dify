/** Versioned, directional predicate vocabulary shared by extraction, embeddings and query plans. */
export const GRAPH_RELATION_CATALOG_VERSION = "graph-relations-v2";

export const GRAPH_RELATION_TYPES = [
  "contradicts",
  "defines",
  "depends_on",
  "mentions",
  "references",
  "supersedes",
  "responsible_for",
  "member_of",
  "reports_to",
  "part_of",
  "owns",
  "provides",
  "uses",
  "collaborates_with",
] as const;

export type GraphRelationType = (typeof GRAPH_RELATION_TYPES)[number];

export const GRAPH_RELATION_DEFINITIONS: Readonly<Record<GraphRelationType, string>> = {
  contradicts: "A contradicts B. A 与 B 矛盾、冲突，不代表替代或否定所有内容。",
  defines: "A defines B. A 定义、规定 B 的含义。",
  depends_on:
    "A depends on B: A requires B to work. A 依赖 B，A 需要 B 才能运行。反向查询 B 被谁依赖，得到 A。",
  mentions: "A mentions B. A 提及 B，仅表示提及，不表示负责、依赖或隶属。",
  references: "A references or cites B. A 引用、参考 B。",
  supersedes: "A supersedes B: A replaces the older B. A 替代、废止旧的 B；B 被 A 取代。",
  responsible_for: "A is responsible for B. A 负责、主管、承担 B 的工作；B 的负责人是 A。",
  member_of: "A is a member of B. A 是 B 的成员、隶属于组织 B；B 包含成员 A。",
  reports_to: "A reports to B. A 向 B 汇报，B 是 A 的上级。",
  part_of: "A is a component or part of B. A 是 B 的组成部分、属于系统 B；B 包含 A。",
  owns: "A owns B. A 拥有 B 的所有权；B 归 A 所有。",
  provides: "A provides B. A 提供、供应服务或能力 B；B 的提供方是 A。",
  uses: "A uses B. A 使用 B；使用不一定代表强制依赖。",
  collaborates_with: "A collaborates with B. A 与 B 合作、协作；这是对称关系。",
};

export function graphRelationSemanticText(type: string): string {
  const definition = GRAPH_RELATION_DEFINITIONS[type as GraphRelationType];
  if (!definition) throw new Error(`Unsupported graph relation type: ${type}`);
  return `${GRAPH_RELATION_CATALOG_VERSION}\n${type}\n${definition}`;
}

export const GRAPH_RELATION_EXTRACTION_INSTRUCTIONS = [
  `Allowed relation types: ${GRAPH_RELATION_TYPES.join(", ")}.`,
  "Extract only explicitly evidenced relationships; never turn co-occurrence or similarity into a fact.",
  ...GRAPH_RELATION_TYPES.map((type) => `${type}: ${GRAPH_RELATION_DEFINITIONS[type]}`),
].join("\n");
