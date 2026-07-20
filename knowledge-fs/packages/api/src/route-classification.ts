export function getTraceRoute(path: string): string {
  if (path === "/health" || path === "/openapi.json" || path === "/knowledge-spaces") {
    return path;
  }

  if (path === "/source-providers" || path === "/source-oauth/callback") return path;

  if (/^\/knowledge-spaces\/[^/]+\/source-connections(?:\/.*)?$/.test(path)) {
    return "/knowledge-spaces/{id}/source-connections/product-resource";
  }

  if (/^\/knowledge-spaces\/[^/]+\/source-workflows(?:\/.*)?$/.test(path)) {
    return "/knowledge-spaces/{id}/source-workflows/product-resource";
  }

  if (
    /^\/knowledge-spaces\/[^/]+\/sources\/[^/]+\/(?:sync|sync-policy|crawl-preview|workflow-imports)$/.test(
      path,
    )
  ) {
    return "/knowledge-spaces/{id}/sources/{sourceId}/sync-product-resource";
  }

  if (/^\/knowledge-spaces\/[^/]+\/sources\/bulk$/.test(path)) {
    return "/knowledge-spaces/{id}/sources/bulk";
  }

  if (/^\/knowledge-spaces\/[^/]+$/.test(path)) {
    return "/knowledge-spaces/{id}";
  }

  if (/^\/knowledge-spaces\/[^/]+\/embedding-profile$/.test(path)) {
    return "/knowledge-spaces/{id}/embedding-profile";
  }

  if (/^\/knowledge-spaces\/[^/]+\/retrieval-profile$/.test(path)) {
    return "/knowledge-spaces/{id}/retrieval-profile";
  }

  if (/^\/knowledge-spaces\/[^/]+\/profiles\/(?:embedding|retrieval)\/revisions$/.test(path)) {
    return "/knowledge-spaces/{id}/profiles/{kind}/revisions";
  }

  if (/^\/knowledge-spaces\/[^/]+\/overview\/(?:stats|activity|attention|health)$/.test(path)) {
    return `/knowledge-spaces/{id}/overview/${path.split("/").at(-1)}`;
  }

  if (/^\/knowledge-spaces\/[^/]+\/overview\/attention\/[^/]+$/.test(path)) {
    return "/knowledge-spaces/{id}/overview/attention/{issueKey}";
  }

  if (/^\/knowledge-spaces\/[^/]+\/quality(?:\/.*)?$/.test(path)) {
    return "/knowledge-spaces/{id}/quality/product-resource";
  }

  if (/^\/knowledge-spaces\/[^/]+\/(?:access-bootstrap|access-policy|api-access)$/.test(path)) {
    return `/knowledge-spaces/{id}/${path.split("/").at(-1)}`;
  }

  if (/^\/knowledge-spaces\/[^/]+\/members$/.test(path)) {
    return "/knowledge-spaces/{id}/members";
  }

  if (/^\/knowledge-spaces\/[^/]+\/members\/[^/]+$/.test(path)) {
    return "/knowledge-spaces/{id}/members/{subjectId}";
  }

  if (/^\/knowledge-spaces\/[^/]+\/api-keys$/.test(path)) {
    return "/knowledge-spaces/{id}/api-keys";
  }

  if (/^\/knowledge-spaces\/[^/]+\/api-keys\/[^/]+$/.test(path)) {
    return "/knowledge-spaces/{id}/api-keys/{keyId}";
  }

  if (/^\/knowledge-spaces\/[^/]+\/fs\/ls$/.test(path)) {
    return "/knowledge-spaces/{id}/fs/ls";
  }

  if (/^\/knowledge-spaces\/[^/]+\/fs\/cat$/.test(path)) {
    return "/knowledge-spaces/{id}/fs/cat";
  }

  if (/^\/knowledge-spaces\/[^/]+\/fs\/grep$/.test(path)) {
    return "/knowledge-spaces/{id}/fs/grep";
  }

  if (/^\/knowledge-spaces\/[^/]+\/fs\/find$/.test(path)) {
    return "/knowledge-spaces/{id}/fs/find";
  }

  if (/^\/knowledge-spaces\/[^/]+\/fs\/diff$/.test(path)) {
    return "/knowledge-spaces/{id}/fs/diff";
  }

  if (/^\/knowledge-spaces\/[^/]+\/fs\/open_node$/.test(path)) {
    return "/knowledge-spaces/{id}/fs/open_node";
  }

  if (/^\/knowledge-spaces\/[^/]+\/fs\/stat$/.test(path)) {
    return "/knowledge-spaces/{id}/fs/stat";
  }

  if (/^\/knowledge-spaces\/[^/]+\/fs\/tree$/.test(path)) {
    return "/knowledge-spaces/{id}/fs/tree";
  }

  if (/^\/knowledge-spaces\/[^/]+\/golden-questions$/.test(path)) {
    return "/knowledge-spaces/{id}/golden-questions";
  }

  if (/^\/knowledge-spaces\/[^/]+\/golden-questions\/[^/]+$/.test(path)) {
    return "/knowledge-spaces/{id}/golden-questions/{questionId}";
  }

  if (/^\/knowledge-spaces\/[^/]+\/retention-policy$/.test(path)) {
    return "/knowledge-spaces/{id}/retention-policy";
  }

  if (/^\/knowledge-spaces\/[^/]+\/graph\/traverse$/.test(path)) {
    return "/knowledge-spaces/{id}/graph/traverse";
  }

  if (/^\/knowledge-spaces\/[^/]+\/semantic-views\/topic\/materialize$/.test(path)) {
    return "/knowledge-spaces/{id}/semantic-views/topic/materialize";
  }

  if (/^\/knowledge-spaces\/[^/]+\/semantic-views\/entities\/extract$/.test(path)) {
    return "/knowledge-spaces/{id}/semantic-views/entities/extract";
  }

  if (/^\/knowledge-spaces\/[^/]+\/semantic-views\/communities\/materialize$/.test(path)) {
    return "/knowledge-spaces/{id}/semantic-views/communities/materialize";
  }

  if (/^\/knowledge-spaces\/[^/]+\/documents$/.test(path)) {
    return "/knowledge-spaces/{id}/documents";
  }

  if (/^\/knowledge-spaces\/[^/]+\/logical-documents$/.test(path)) {
    return "/knowledge-spaces/{id}/logical-documents";
  }

  if (/^\/knowledge-spaces\/[^/]+\/logical-documents\/[^/]+$/.test(path)) {
    return "/knowledge-spaces/{id}/logical-documents/{documentId}";
  }

  if (/^\/knowledge-spaces\/[^/]+\/processing-tasks$/.test(path)) {
    return "/knowledge-spaces/{id}/processing-tasks";
  }

  if (
    /^\/knowledge-spaces\/[^/]+\/documents\/[^/]+\/(?:metadata|settings|revisions|processing-tasks)(?:\/.*)?$/.test(
      path,
    )
  ) {
    return "/knowledge-spaces/{id}/documents/{documentId}/product-resource";
  }

  if (/^\/knowledge-spaces\/[^/]+\/documents\/bulk$/.test(path)) {
    return "/knowledge-spaces/{id}/documents/bulk";
  }

  if (/^\/knowledge-spaces\/[^/]+\/documents\/bulk\/reindex$/.test(path)) {
    return "/knowledge-spaces/{id}/documents/bulk/reindex";
  }

  if (/^\/knowledge-spaces\/[^/]+\/documents\/[^/]+$/.test(path)) {
    return "/knowledge-spaces/{id}/documents/{documentId}";
  }

  if (/^\/knowledge-spaces\/[^/]+\/documents\/[^/]+\/parse-artifacts\/[^/]+$/.test(path)) {
    return "/knowledge-spaces/{id}/documents/{documentId}/parse-artifacts/{version}";
  }

  if (/^\/jobs\/[^/]+$/.test(path)) {
    return "/jobs/{id}";
  }

  if (/^\/bulk-jobs\/[^/]+$/.test(path)) {
    return "/bulk-jobs/{id}";
  }

  if (path === "/retention-policy") {
    return "/retention-policy";
  }

  if (path === "/queries") {
    return "/queries";
  }

  if (/^\/queries\/[^/]+$/.test(path)) {
    return "/queries/{traceId}";
  }

  return "unmatched";
}

export function getRateLimitTool(method: string, path: string): string {
  const normalizedMethod = method.toUpperCase();
  if (path === "/source-providers") return "source-providers.list";
  if (path === "/source-oauth/callback") return "source-connections.oauth.callback";
  if (/^\/knowledge-spaces\/[^/]+\/(?:source-connections|source-workflows)(?:\/.*)?$/.test(path)) {
    return normalizedMethod === "GET" ? "sources.product.read" : "sources.product.write";
  }
  if (
    /^\/knowledge-spaces\/[^/]+\/sources\/(?:bulk|[^/]+\/(?:sync|sync-policy|crawl-preview|workflow-imports))$/.test(
      path,
    )
  ) {
    return normalizedMethod === "GET" ? "sources.product.read" : "sources.product.write";
  }
  if (path === "/queries") {
    return "queries.stream";
  }

  if (path === "/knowledge-spaces") {
    return normalizedMethod === "GET" ? "knowledge-spaces.list" : "knowledge-spaces.create";
  }

  if (/^\/knowledge-spaces\/[^/]+\/(?:access-bootstrap|access-policy|api-access)$/.test(path)) {
    return `knowledge-spaces.${path.split("/").at(-1)}`;
  }

  if (/^\/knowledge-spaces\/[^/]+\/members(?:\/[^/]+)?$/.test(path)) {
    return normalizedMethod === "GET"
      ? "knowledge-spaces.members.read"
      : "knowledge-spaces.members.write";
  }

  if (/^\/knowledge-spaces\/[^/]+\/api-keys(?:\/[^/]+)?$/.test(path)) {
    return normalizedMethod === "GET"
      ? "knowledge-spaces.api-keys.read"
      : "knowledge-spaces.api-keys.write";
  }

  if (/^\/knowledge-spaces\/[^/]+\/profiles\/(?:embedding|retrieval)\/revisions$/.test(path)) {
    return "knowledge-spaces.profiles.revisions.list";
  }

  if (/^\/knowledge-spaces\/[^/]+\/overview\/(?:stats|activity|attention|health)$/.test(path)) {
    return `knowledge-spaces.overview.${path.split("/").at(-1)}.read`;
  }

  if (/^\/knowledge-spaces\/[^/]+\/overview\/attention\/[^/]+$/.test(path)) {
    return normalizedMethod === "GET"
      ? "knowledge-spaces.overview.attention.read"
      : "knowledge-spaces.overview.attention.write";
  }

  if (/^\/knowledge-spaces\/[^/]+\/quality(?:\/.*)?$/.test(path)) {
    return normalizedMethod === "GET" ? "quality.read" : "quality.write";
  }

  if (/^\/knowledge-spaces\/[^/]+\/documents$/.test(path)) {
    return "documents.upload";
  }

  if (
    /^\/knowledge-spaces\/[^/]+\/(?:logical-documents|processing-tasks)(?:\/[^/]+)?$/.test(path)
  ) {
    return normalizedMethod === "GET" ? "documents.product.read" : "documents.product.write";
  }

  if (
    /^\/knowledge-spaces\/[^/]+\/documents\/[^/]+\/(?:metadata|settings|revisions|processing-tasks)(?:\/.*)?$/.test(
      path,
    )
  ) {
    return normalizedMethod === "GET" ? "documents.product.read" : "documents.product.write";
  }

  if (/^\/knowledge-spaces\/[^/]+\/documents\/bulk$/.test(path)) {
    return normalizedMethod === "DELETE" ? "documents.bulk-delete" : "documents.bulk-upload";
  }

  if (/^\/knowledge-spaces\/[^/]+\/documents\/bulk\/reindex$/.test(path)) {
    return "documents.bulk-reindex";
  }

  if (/^\/knowledge-spaces\/[^/]+\/documents\/[^/]+\/parse-artifacts\/[^/]+$/.test(path)) {
    return "parse-artifacts.get";
  }

  if (/^\/knowledge-spaces\/[^/]+\/documents\/[^/]+$/.test(path)) {
    return "documents.get";
  }

  if (/^\/jobs\/[^/]+$/.test(path)) {
    return normalizedMethod === "GET" ? "jobs.get" : "jobs.cancel";
  }

  if (path === "/research-tasks/plan") {
    return "research-tasks.plan";
  }

  if (path === "/research-tasks") {
    return "research-tasks.create";
  }

  if (/^\/research-tasks\/[^/]+\/partials$/.test(path)) {
    return "research-tasks.partials.list";
  }

  if (/^\/research-tasks\/[^/]+$/.test(path)) {
    return normalizedMethod === "GET" ? "research-tasks.get" : "research-tasks.cancel";
  }

  if (/^\/bulk-jobs\/[^/]+$/.test(path)) {
    return "bulk-jobs.get";
  }

  if (path === "/retention-policy") {
    return normalizedMethod === "GET" ? "retention-policy.get" : "retention-policy.update";
  }

  if (/^\/knowledge-spaces\/[^/]+\/retention-policy$/.test(path)) {
    return normalizedMethod === "GET"
      ? "knowledge-spaces.retention-policy.get"
      : "knowledge-spaces.retention-policy.update";
  }

  if (/^\/knowledge-spaces\/[^/]+\/graph\/traverse$/.test(path)) {
    return "graph.traverse";
  }

  if (/^\/knowledge-spaces\/[^/]+\/semantic-views\/topic\/materialize$/.test(path)) {
    return "semantic-views.topic.materialize";
  }

  if (/^\/knowledge-spaces\/[^/]+\/semantic-views\/entities\/extract$/.test(path)) {
    return "semantic-views.entities.extract";
  }

  if (/^\/knowledge-spaces\/[^/]+\/semantic-views\/communities\/materialize$/.test(path)) {
    return "semantic-views.communities.materialize";
  }

  if (/^\/knowledge-spaces\/[^/]+\/production-bad-cases$/.test(path)) {
    return "evaluation.bad-cases.capture";
  }

  if (/^\/knowledge-spaces\/[^/]+\/golden-questions\/[^/]+\/annotations$/.test(path)) {
    return "golden-questions.annotations.write";
  }

  const fsMatch = path.match(/^\/knowledge-spaces\/[^/]+\/fs\/([^/]+)$/);

  if (fsMatch?.[1]) {
    return `knowledge.fs.${fsMatch[1]}`;
  }

  const goldenQuestionMatch = path.match(
    /^\/knowledge-spaces\/[^/]+\/golden-questions(?:\/[^/]+)?$/,
  );

  if (goldenQuestionMatch) {
    return normalizedMethod === "GET" ? "golden-questions.read" : "golden-questions.write";
  }

  if (/^\/knowledge-spaces\/[^/]+$/.test(path)) {
    if (normalizedMethod === "GET") {
      return "knowledge-spaces.get";
    }

    return normalizedMethod === "DELETE" ? "knowledge-spaces.delete" : "knowledge-spaces.update";
  }

  if (/^\/queries\/[^/]+$/.test(path)) {
    return "queries.trace.get";
  }

  return `${normalizedMethod.toLowerCase()} ${getTraceRoute(path)}`;
}
