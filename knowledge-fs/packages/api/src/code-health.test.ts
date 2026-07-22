import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("API code health guardrails", () => {
  it("does not reintroduce Hono context any assertions in route handlers", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");

    expect(gatewaySource).not.toContain("context: any");
    expect(gatewaySource).not.toContain("noExplicitAny: Hono OpenAPI route inference");
  });

  it("keeps trace recorder plumbing outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const tracingSource = readFileSync(resolve(import.meta.dirname, "tracing.ts"), "utf8");

    expect(gatewaySource).toContain('export * from "./tracing"');
    expect(gatewaySource).not.toContain("export function createInMemoryTraceRecorder");
    expect(tracingSource).toContain("export function createInMemoryTraceRecorder");
  });

  it("keeps shared JSON utilities outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const jsonUtilsSource = readFileSync(resolve(import.meta.dirname, "json-utils.ts"), "utf8");

    expect(gatewaySource).toContain('export * from "./json-utils"');
    expect(gatewaySource).not.toContain("function jsonObjectColumn");
    expect(gatewaySource).not.toContain("function jsonArrayColumn");
    expect(jsonUtilsSource).toContain("export function jsonObjectColumn");
  });

  it("keeps database row column utilities outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const rowUtilsSource = readFileSync(
      resolve(import.meta.dirname, "database-row-utils.ts"),
      "utf8",
    );

    expect(gatewaySource).toContain('export * from "./database-row-utils"');
    expect(gatewaySource).not.toContain("function stringColumn");
    expect(gatewaySource).not.toContain("function numberColumn");
    expect(rowUtilsSource).toContain("export function stringColumn");
  });

  it("keeps database SQL utilities outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const sqlUtilsSource = readFileSync(
      resolve(import.meta.dirname, "database-sql-utils.ts"),
      "utf8",
    );

    expect(gatewaySource).toContain('export * from "./database-sql-utils"');
    expect(gatewaySource).not.toContain("function quoteDatabaseIdentifier");
    expect(gatewaySource).not.toContain("function databasePlaceholder");
    expect(sqlUtilsSource).toContain("export function quoteDatabaseIdentifier");
  });

  it("keeps auth verification and scope helpers outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const authSource = readFileSync(resolve(import.meta.dirname, "auth.ts"), "utf8");

    expect(gatewaySource).toContain('export * from "./auth"');
    expect(gatewaySource).not.toContain("export function createJwtAuthVerifier");
    expect(gatewaySource).not.toContain("function createAuthMiddleware");
    expect(gatewaySource).not.toContain("function getRequiredScope");
    expect(authSource).toContain("export function createJwtAuthVerifier");
    expect(authSource).toContain("export function createAuthMiddleware");
  });

  it("keeps SSE event formatting outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const sseSource = readFileSync(resolve(import.meta.dirname, "sse-events.ts"), "utf8");

    expect(gatewaySource).toContain('export * from "./sse-events"');
    expect(gatewaySource).not.toContain("function formatQuerySseEvent");
    expect(gatewaySource).not.toContain("function formatResearchTaskProgressSseEvent");
    expect(gatewaySource).not.toContain("function formatSseEvent");
    expect(sseSource).toContain("export function formatQuerySseEvent");
  });

  it("keeps SSE response streaming outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const responseSource = readFileSync(
      resolve(import.meta.dirname, "gateway-sse-responses.ts"),
      "utf8",
    );

    expect(gatewaySource).toContain('export * from "./gateway-sse-responses"');
    expect(gatewaySource).not.toContain("function createQuerySseResponse");
    expect(gatewaySource).not.toContain("function createResearchTaskProgressSseResponse");
    expect(responseSource).not.toContain('from "./index"');
    expect(responseSource).toContain("export function createQuerySseResponse");
  });

  it("keeps KnowledgeFS result contracts outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const knowledgeFsSource = readFileSync(
      resolve(import.meta.dirname, "knowledge-fs-types.ts"),
      "utf8",
    );

    expect(gatewaySource).toContain('export * from "./knowledge-fs-types"');
    expect(gatewaySource).not.toContain("export interface KnowledgeFsEntry");
    expect(gatewaySource).not.toContain("export interface KnowledgeFsDiffResult");
    expect(gatewaySource).not.toContain("export interface SemanticDiffProvider");
    expect(knowledgeFsSource).not.toContain('from "./index"');
    expect(knowledgeFsSource).toContain("export interface KnowledgeFsEntry");
  });

  it("keeps SourceFS result contracts outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const sourceFsSource = readFileSync(resolve(import.meta.dirname, "source-fs-types.ts"), "utf8");

    expect(gatewaySource).toContain('export * from "./source-fs-types"');
    expect(gatewaySource).not.toContain("export interface SourceFsEntry");
    expect(gatewaySource).not.toContain("export interface SourceFsGrepResult");
    expect(sourceFsSource).not.toContain('from "./index"');
    expect(sourceFsSource).toContain("export interface SourceFsEntry");
  });

  it("keeps SourceFS command registry outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const sourceFsRegistrySource = readFileSync(
      resolve(import.meta.dirname, "source-fs-command-registry.ts"),
      "utf8",
    );

    expect(gatewaySource).toContain('export * from "./source-fs-command-registry"');
    expect(gatewaySource).not.toContain("export function createSourceFsCommandRegistry");
    expect(gatewaySource).not.toContain("function resolveSourceFsMount");
    expect(sourceFsRegistrySource).not.toContain('from "./index"');
    expect(sourceFsRegistrySource).toContain("export function createSourceFsCommandRegistry");
  });

  it("keeps golden question annotation metadata helpers outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const annotationSource = readFileSync(
      resolve(import.meta.dirname, "golden-question-annotation.ts"),
      "utf8",
    );

    expect(gatewaySource).toContain('export * from "./golden-question-annotation"');
    expect(gatewaySource).not.toContain("function annotatedGoldenQuestionMetadata");
    expect(gatewaySource).not.toContain("MAX_GOLDEN_QUESTION_ANNOTATIONS");
    expect(annotationSource).not.toContain('from "./index"');
    expect(annotationSource).toContain("export function annotatedGoldenQuestionMetadata");
  });

  it("keeps query virtual entry helpers outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const querySource = readFileSync(
      resolve(import.meta.dirname, "query-virtual-entries.ts"),
      "utf8",
    );

    expect(gatewaySource).toContain('export * from "./query-virtual-entries"');
    expect(gatewaySource).not.toContain("function evidenceBundleFromAnswerTrace");
    expect(gatewaySource).not.toContain("function productionBadCaseGoldenQuestionInput");
    expect(gatewaySource).not.toContain("function paginateQueryVirtualEntries");
    expect(querySource).not.toContain('from "./index"');
    expect(querySource).toContain("export function queryEvidenceEntries");
  });

  it("keeps KnowledgeFS command registry outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const registrySource = readFileSync(
      resolve(import.meta.dirname, "knowledge-fs-command-registry.ts"),
      "utf8",
    );

    expect(gatewaySource).toContain('export * from "./knowledge-fs-command-registry"');
    expect(gatewaySource).not.toContain("function createKnowledgeFsCommandRegistry");
    expect(gatewaySource).not.toContain("async function listKnowledgeFsDirectory");
    expect(gatewaySource).not.toContain("function renderKnowledgeFsTableHtml");
    expect(registrySource).not.toContain('from "./index"');
    expect(registrySource).toContain("export function createKnowledgeFsCommandRegistry");
  });

  it("keeps bulk operation response summaries outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const summarySource = readFileSync(
      resolve(import.meta.dirname, "bulk-operation-summary.ts"),
      "utf8",
    );

    expect(gatewaySource).toContain('export * from "./bulk-operation-summary"');
    expect(gatewaySource).not.toContain("async function summarizeBulkOperation");
    expect(gatewaySource).not.toContain("function summarizeCompilationItemStatus");
    expect(summarySource).not.toContain('from "./index"');
    expect(summarySource).toContain("export async function summarizeBulkOperation");
  });

  it("keeps tenant-scoped answer trace access outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const accessSource = readFileSync(
      resolve(import.meta.dirname, "answer-trace-access.ts"),
      "utf8",
    );

    expect(gatewaySource).toContain('export * from "./answer-trace-access"');
    expect(gatewaySource).not.toContain("async function getTenantScopedAnswerTrace");
    expect(accessSource).not.toContain('from "./index"');
    expect(accessSource).toContain("export async function getTenantScopedAnswerTrace");
  });

  it("keeps async trace span wrapping outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const traceAsyncSource = readFileSync(resolve(import.meta.dirname, "trace-async.ts"), "utf8");

    expect(gatewaySource).toContain('export * from "./trace-async"');
    expect(gatewaySource).not.toContain("async function traceAsync");
    expect(traceAsyncSource).not.toContain('from "./index"');
    expect(traceAsyncSource).toContain("export async function traceAsync");
  });

  it("keeps gateway option contracts outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const optionsSource = readFileSync(resolve(import.meta.dirname, "gateway-options.ts"), "utf8");

    expect(gatewaySource).toContain('export * from "./gateway-options"');
    expect(gatewaySource).not.toContain("export interface KnowledgeGatewayOptions");
    expect(optionsSource).not.toContain('from "./index"');
    expect(optionsSource).toContain("export interface KnowledgeGatewayOptions");
  });

  it("keeps gateway OpenAPI shared contracts outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const contractsSource = readFileSync(
      resolve(import.meta.dirname, "gateway-openapi-contracts.ts"),
      "utf8",
    );

    expect(gatewaySource).toContain('export * from "./gateway-openapi-contracts"');
    expect(gatewaySource).not.toContain("type KnowledgeGatewayEnv =");
    expect(gatewaySource).not.toContain("const UnauthorizedResponse");
    expect(gatewaySource).not.toContain("const ForbiddenResponse");
    expect(contractsSource).not.toContain('from "./index"');
    expect(contractsSource).toContain("export type KnowledgeGatewayEnv");
  });

  it("keeps KnowledgeSpace route definitions outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const routesSource = readFileSync(
      resolve(import.meta.dirname, "knowledge-space-routes.ts"),
      "utf8",
    );

    expect(gatewaySource).toContain('export * from "./knowledge-space-routes"');
    expect(gatewaySource).not.toContain("const createKnowledgeSpaceRoute = createRoute");
    expect(gatewaySource).not.toContain("const listKnowledgeSpacesRoute = createRoute");
    expect(gatewaySource).not.toContain("const deleteKnowledgeSpaceRoute = createRoute");
    expect(routesSource).not.toContain('from "./index"');
    expect(routesSource).toContain("export const createKnowledgeSpaceRoute");
  });

  it("keeps KnowledgeSpace handler registration outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const handlersSource = readFileSync(
      resolve(import.meta.dirname, "knowledge-space-handlers.ts"),
      "utf8",
    );

    expect(gatewaySource).toContain('export * from "./knowledge-space-handlers"');
    expect(gatewaySource).toContain("registerKnowledgeSpaceHandlers({");
    expect(gatewaySource).not.toContain("app.openapi(createKnowledgeSpaceRoute");
    expect(gatewaySource).not.toContain("app.openapi(listKnowledgeSpacesRoute");
    expect(gatewaySource).not.toContain("app.openapi(deleteKnowledgeSpaceRoute");
    expect(handlersSource).not.toContain('from "./index"');
    expect(handlersSource).toContain("export function registerKnowledgeSpaceHandlers");
  });

  it("keeps golden question route definitions outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const routesSource = readFileSync(
      resolve(import.meta.dirname, "golden-question-routes.ts"),
      "utf8",
    );

    expect(gatewaySource).toContain('export * from "./golden-question-routes"');
    expect(gatewaySource).not.toContain("const createGoldenQuestionRoute = createRoute");
    expect(gatewaySource).not.toContain("const annotateGoldenQuestionRoute = createRoute");
    expect(gatewaySource).not.toContain("const createProductionBadCaseRoute = createRoute");
    expect(routesSource).not.toContain('from "./index"');
    expect(routesSource).toContain("export const createGoldenQuestionRoute");
  });

  it("keeps golden question handler registration outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const handlersSource = readFileSync(
      resolve(import.meta.dirname, "golden-question-handlers.ts"),
      "utf8",
    );

    expect(gatewaySource).toContain('export * from "./golden-question-handlers"');
    expect(gatewaySource).toContain("registerGoldenQuestionHandlers({");
    expect(gatewaySource).not.toContain("app.openapi(createGoldenQuestionRoute");
    expect(gatewaySource).not.toContain("app.openapi(listGoldenQuestionsRoute");
    expect(gatewaySource).not.toContain("app.openapi(createProductionBadCaseRoute");
    expect(handlersSource).not.toContain('from "./index"');
    expect(handlersSource).toContain("export function registerGoldenQuestionHandlers");
  });

  it("keeps gateway system route definitions outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const routesSource = readFileSync(
      resolve(import.meta.dirname, "gateway-system-routes.ts"),
      "utf8",
    );

    expect(gatewaySource).toContain('export * from "./gateway-system-routes"');
    expect(gatewaySource).not.toContain("const healthRoute = createRoute");
    expect(routesSource).not.toContain('from "./index"');
    expect(routesSource).toContain("export const healthRoute");
  });

  it("keeps gateway system handler registration outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const handlersSource = readFileSync(
      resolve(import.meta.dirname, "gateway-system-handlers.ts"),
      "utf8",
    );

    expect(gatewaySource).toContain('export * from "./gateway-system-handlers"');
    expect(gatewaySource).toContain("registerGatewaySystemHandlers({");
    expect(gatewaySource).not.toContain("app.openapi(healthRoute");
    expect(handlersSource).not.toContain('from "./index"');
    expect(handlersSource).toContain("export function registerGatewaySystemHandlers");
  });

  it("keeps OpenAPI document metadata outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const documentSource = readFileSync(
      resolve(import.meta.dirname, "gateway-openapi-document.ts"),
      "utf8",
    );

    expect(gatewaySource).toContain('export * from "./gateway-openapi-document"');
    expect(gatewaySource).not.toContain('title: "Knowledge Platform API"');
    expect(documentSource).not.toContain('from "./index"');
    expect(documentSource).toContain("export const knowledgeGatewayOpenApiDocument");
  });

  it("keeps gateway error handlers outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const errorSource = readFileSync(
      resolve(import.meta.dirname, "gateway-error-handlers.ts"),
      "utf8",
    );

    expect(gatewaySource).toContain('export * from "./gateway-error-handlers"');
    expect(gatewaySource).not.toContain('console.error("Unhandled gateway error"');
    expect(gatewaySource).not.toContain("app.notFound((context)");
    expect(errorSource).not.toContain('from "./index"');
    expect(errorSource).toContain("export function handleGatewayError");
  });

  it("keeps gateway app shell construction outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const appSource = readFileSync(resolve(import.meta.dirname, "gateway-app.ts"), "utf8");

    expect(gatewaySource).toContain('export * from "./gateway-app"');
    expect(gatewaySource).not.toContain("new OpenAPIHono");
    expect(gatewaySource).not.toContain("app.onError(");
    expect(appSource).not.toContain('from "./index"');
    expect(appSource).toContain("export function createKnowledgeGatewayApp");
  });

  it("keeps document read route definitions outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const routesSource = readFileSync(
      resolve(import.meta.dirname, "document-read-routes.ts"),
      "utf8",
    );

    expect(gatewaySource).toContain('export * from "./document-read-routes"');
    expect(gatewaySource).not.toContain("const getDocumentAssetRoute = createRoute");
    expect(gatewaySource).not.toContain("const getParseArtifactRoute = createRoute");
    expect(routesSource).not.toContain('from "./index"');
    expect(routesSource).toContain("export const getDocumentAssetRoute");
  });

  it("keeps document read handler registration outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const handlersSource = readFileSync(
      resolve(import.meta.dirname, "document-read-handlers.ts"),
      "utf8",
    );

    expect(gatewaySource).toContain('export * from "./document-read-handlers"');
    expect(gatewaySource).toContain("registerDocumentReadHandlers({");
    expect(gatewaySource).not.toContain("app.openapi(getDocumentAssetRoute");
    expect(gatewaySource).not.toContain("app.openapi(getParseArtifactRoute");
    expect(handlersSource).not.toContain('from "./index"');
    expect(handlersSource).toContain("export function registerDocumentReadHandlers");
  });

  it("keeps document write route definitions outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const routesSource = readFileSync(
      resolve(import.meta.dirname, "document-write-routes.ts"),
      "utf8",
    );

    expect(gatewaySource).toContain('export * from "./document-write-routes"');
    expect(gatewaySource).not.toContain("const uploadDocumentRoute = createRoute");
    expect(gatewaySource).not.toContain("const bulkUploadDocumentsRoute = createRoute");
    expect(gatewaySource).not.toContain("const bulkDeleteDocumentsRoute = createRoute");
    expect(gatewaySource).not.toContain("const bulkReindexDocumentsRoute = createRoute");
    expect(routesSource).not.toContain('from "./index"');
    expect(routesSource).toContain("export const uploadDocumentRoute");
  });

  it("keeps document write handler registration outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const handlersSource = readFileSync(
      resolve(import.meta.dirname, "document-write-handlers.ts"),
      "utf8",
    );

    expect(gatewaySource).toContain('export * from "./document-write-handlers"');
    expect(gatewaySource).toContain("registerDocumentWriteHandlers({");
    expect(gatewaySource).not.toContain("app.openapi(uploadDocumentRoute");
    expect(gatewaySource).not.toContain("app.openapi(bulkUploadDocumentsRoute");
    expect(gatewaySource).not.toContain("app.openapi(bulkDeleteDocumentsRoute");
    expect(gatewaySource).not.toContain("app.openapi(bulkReindexDocumentsRoute");
    expect(handlersSource).not.toContain('from "./index"');
    expect(handlersSource).toContain("export function registerDocumentWriteHandlers");
  });

  it("keeps document write gateway tests outside the cross-domain gateway test file", () => {
    const gatewayTestSource = readFileSync(resolve(import.meta.dirname, "gateway.test.ts"), "utf8");
    const documentWriteTestSource = readFileSync(
      resolve(import.meta.dirname, "gateway-document-write.test.ts"),
      "utf8",
    );

    expect(gatewayTestSource.split("\n").length).toBeLessThanOrEqual(14_500);
    expect(gatewayTestSource).not.toContain(
      'it("uploads a document asset into tenant-scoped object storage"',
    );
    expect(documentWriteTestSource).toContain('describe("document write gateway integration"');
    expect(documentWriteTestSource).toContain(
      'it("uploads a document asset into tenant-scoped object storage"',
    );
  });

  it("keeps document bulk gateway tests outside the cross-domain gateway test file", () => {
    const gatewayTestSource = readFileSync(resolve(import.meta.dirname, "gateway.test.ts"), "utf8");
    const documentWriteTestSource = readFileSync(
      resolve(import.meta.dirname, "gateway-document-write.test.ts"),
      "utf8",
    );

    expect(gatewayTestSource.split("\n").length).toBeLessThanOrEqual(13_600);
    expect(gatewayTestSource).not.toContain(
      'it("accepts bounded bulk document uploads as durable compilation jobs"',
    );
    expect(gatewayTestSource).not.toContain(
      'it("accepts durable bulk deletion without synchronously removing document data"',
    );
    expect(gatewayTestSource).not.toContain(
      'it("bulk reindexes selected or all tenant-scoped documents with durable compilation jobs"',
    );
    expect(documentWriteTestSource).toContain(
      'it("accepts bounded bulk document uploads as durable compilation jobs"',
    );
    expect(documentWriteTestSource).toContain(
      'it("accepts durable bulk deletion without synchronously removing document data"',
    );
  });

  it("keeps document compilation gateway route tests outside the cross-domain gateway test file", () => {
    const gatewayTestSource = readFileSync(resolve(import.meta.dirname, "gateway.test.ts"), "utf8");
    const documentCompilationTestSource = readFileSync(
      resolve(import.meta.dirname, "gateway-document-compilation.test.ts"),
      "utf8",
    );

    // Budget bumped from 13_450: the file crossed it on main (visual_vector fake-executor
    // columns + prior merges). The next addition should extract a domain test file instead.
    expect(gatewayTestSource.split("\n").length).toBeLessThanOrEqual(13_500);
    expect(gatewayTestSource).not.toContain(
      'it("protects tenant-scoped document compilation job status and cancellation APIs"',
    );
    expect(documentCompilationTestSource).toContain(
      'describe("document compilation gateway integration"',
    );
    expect(documentCompilationTestSource).toContain(
      'it("protects tenant-scoped document compilation job status and cancellation APIs"',
    );
  });

  it("keeps document compilation route definitions outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const routesSource = readFileSync(
      resolve(import.meta.dirname, "document-compilation-routes.ts"),
      "utf8",
    );

    expect(gatewaySource).toContain('export * from "./document-compilation-routes"');
    expect(gatewaySource).not.toContain("const getDocumentCompilationJobRoute = createRoute");
    expect(gatewaySource).not.toContain("const cancelDocumentCompilationJobRoute = createRoute");
    expect(gatewaySource).not.toContain("const retryDocumentCompilationJobRoute = createRoute");
    expect(routesSource).not.toContain('from "./index"');
    expect(routesSource).toContain("export const getDocumentCompilationJobRoute");
    expect(routesSource).toContain("export const retryDocumentCompilationJobRoute");
  });

  it("keeps document compilation handler registration outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const handlersSource = readFileSync(
      resolve(import.meta.dirname, "document-compilation-handlers.ts"),
      "utf8",
    );

    expect(gatewaySource).toContain('export * from "./document-compilation-handlers"');
    expect(gatewaySource).toContain("registerDocumentCompilationHandlers({");
    expect(gatewaySource).not.toContain("app.openapi(getDocumentCompilationJobRoute");
    expect(gatewaySource).not.toContain("app.openapi(cancelDocumentCompilationJobRoute");
    expect(gatewaySource).not.toContain("app.openapi(retryDocumentCompilationJobRoute");
    expect(handlersSource).not.toContain('from "./index"');
    expect(handlersSource).toContain("export function registerDocumentCompilationHandlers");
  });

  it("keeps research task route definitions outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const routesSource = readFileSync(
      resolve(import.meta.dirname, "research-task-routes.ts"),
      "utf8",
    );

    expect(gatewaySource).toContain('export * from "./research-task-routes"');
    expect(gatewaySource).not.toContain("const planResearchTaskRoute = createRoute");
    expect(gatewaySource).not.toContain("const createResearchTaskRoute = createRoute");
    expect(gatewaySource).not.toContain("const getResearchTaskRoute = createRoute");
    expect(gatewaySource).not.toContain("const streamResearchTaskProgressRoute = createRoute");
    expect(gatewaySource).not.toContain("const cancelResearchTaskRoute = createRoute");
    expect(routesSource).not.toContain('from "./index"');
    expect(routesSource).toContain("export const planResearchTaskRoute");
  });

  it("keeps research task handler registration outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const handlersSource = readFileSync(
      resolve(import.meta.dirname, "research-task-handlers.ts"),
      "utf8",
    );

    expect(gatewaySource).toContain('export * from "./research-task-handlers"');
    expect(gatewaySource).toContain("registerResearchTaskHandlers({");
    expect(gatewaySource).not.toContain("app.openapi(planResearchTaskRoute");
    expect(gatewaySource).not.toContain("app.openapi(createResearchTaskRoute");
    expect(gatewaySource).not.toContain("app.openapi(getResearchTaskRoute");
    expect(gatewaySource).not.toContain("app.openapi(listResearchTaskPartialsRoute");
    expect(gatewaySource).not.toContain("app.openapi(streamResearchTaskProgressRoute");
    expect(gatewaySource).not.toContain("app.openapi(cancelResearchTaskRoute");
    expect(handlersSource).not.toContain('from "./index"');
    expect(handlersSource).toContain("export function registerResearchTaskHandlers");
  });

  it("keeps agent workspace snapshot route definitions outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const routesSource = readFileSync(
      resolve(import.meta.dirname, "agent-workspace-snapshot-routes.ts"),
      "utf8",
    );

    expect(gatewaySource).toContain('export * from "./agent-workspace-snapshot-routes"');
    expect(gatewaySource).not.toContain("const createAgentWorkspaceSnapshotRoute = createRoute");
    expect(gatewaySource).not.toContain("const getAgentWorkspaceSnapshotRoute = createRoute");
    expect(gatewaySource).not.toContain("const replayAgentWorkspaceSnapshotRoute = createRoute");
    expect(routesSource).not.toContain('from "./index"');
    expect(routesSource).toContain("export const createAgentWorkspaceSnapshotRoute");
  });

  it("keeps agent workspace snapshot handler registration outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const handlersSource = readFileSync(
      resolve(import.meta.dirname, "agent-workspace-snapshot-handlers.ts"),
      "utf8",
    );

    expect(gatewaySource).toContain('export * from "./agent-workspace-snapshot-handlers"');
    expect(gatewaySource).toContain("registerAgentWorkspaceSnapshotHandlers({");
    expect(gatewaySource).not.toContain("app.openapi(createAgentWorkspaceSnapshotRoute");
    expect(gatewaySource).not.toContain("app.openapi(getAgentWorkspaceSnapshotRoute");
    expect(gatewaySource).not.toContain("app.openapi(replayAgentWorkspaceSnapshotRoute");
    expect(handlersSource).not.toContain('from "./index"');
    expect(handlersSource).toContain("export function registerAgentWorkspaceSnapshotHandlers");
  });

  it("keeps answer trace route definitions outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const routesSource = readFileSync(
      resolve(import.meta.dirname, "answer-trace-routes.ts"),
      "utf8",
    );

    expect(gatewaySource).toContain('export * from "./answer-trace-routes"');
    expect(gatewaySource).not.toContain("const getAnswerTraceRoute = createRoute");
    expect(gatewaySource).not.toContain("const listQueryEvidenceRoute = createRoute");
    expect(gatewaySource).not.toContain("const listQueryConflictsRoute = createRoute");
    expect(gatewaySource).not.toContain("const listQueryMissingRoute = createRoute");
    expect(routesSource).not.toContain('from "./index"');
    expect(routesSource).toContain("export const getAnswerTraceRoute");
  });

  it("keeps answer trace handler registration outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const handlersSource = readFileSync(
      resolve(import.meta.dirname, "answer-trace-handlers.ts"),
      "utf8",
    );

    expect(gatewaySource).toContain('export * from "./answer-trace-handlers"');
    expect(gatewaySource).toContain("registerAnswerTraceHandlers({");
    expect(gatewaySource).not.toContain("app.openapi(getAnswerTraceRoute");
    expect(gatewaySource).not.toContain("app.openapi(listQueryEvidenceRoute");
    expect(gatewaySource).not.toContain("app.openapi(listQueryConflictsRoute");
    expect(gatewaySource).not.toContain("app.openapi(listQueryMissingRoute");
    expect(handlersSource).not.toContain('from "./index"');
    expect(handlersSource).toContain("export function registerAnswerTraceHandlers");
  });

  it("keeps operation policy route definitions outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const routesSource = readFileSync(
      resolve(import.meta.dirname, "operation-policy-routes.ts"),
      "utf8",
    );

    expect(gatewaySource).toContain('export * from "./operation-policy-routes"');
    expect(gatewaySource).not.toContain("const getBulkOperationRoute = createRoute");
    expect(gatewaySource).not.toContain("const getTenantRetentionPolicyRoute = createRoute");
    expect(gatewaySource).not.toContain("const updateTenantRetentionPolicyRoute = createRoute");
    expect(gatewaySource).not.toContain(
      "const getKnowledgeSpaceRetentionPolicyRoute = createRoute",
    );
    expect(gatewaySource).not.toContain(
      "const updateKnowledgeSpaceRetentionPolicyRoute = createRoute",
    );
    expect(routesSource).not.toContain('from "./index"');
    expect(routesSource).toContain("export const getBulkOperationRoute");
  });

  it("keeps operation policy handler registration outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const handlersSource = readFileSync(
      resolve(import.meta.dirname, "operation-policy-handlers.ts"),
      "utf8",
    );

    expect(gatewaySource).toContain('export * from "./operation-policy-handlers"');
    expect(gatewaySource).toContain("registerOperationPolicyHandlers({");
    expect(gatewaySource).not.toContain("app.openapi(getBulkOperationRoute");
    expect(gatewaySource).not.toContain("app.openapi(getTenantRetentionPolicyRoute");
    expect(gatewaySource).not.toContain("app.openapi(updateTenantRetentionPolicyRoute");
    expect(gatewaySource).not.toContain("app.openapi(getKnowledgeSpaceRetentionPolicyRoute");
    expect(gatewaySource).not.toContain("app.openapi(updateKnowledgeSpaceRetentionPolicyRoute");
    expect(handlersSource).not.toContain('from "./index"');
    expect(handlersSource).toContain("export function registerOperationPolicyHandlers");
  });

  it("keeps graph route definitions outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const routesSource = readFileSync(resolve(import.meta.dirname, "graph-routes.ts"), "utf8");

    expect(gatewaySource).toContain('export * from "./graph-routes"');
    expect(gatewaySource).not.toContain("const traverseGraphRoute = createRoute");
    expect(routesSource).not.toContain('from "./index"');
    expect(routesSource).toContain("export const traverseGraphRoute");
  });

  it("keeps graph handler registration outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const handlersSource = readFileSync(resolve(import.meta.dirname, "graph-handlers.ts"), "utf8");

    expect(gatewaySource).toContain('export * from "./graph-handlers"');
    expect(gatewaySource).toContain("registerGraphHandlers({");
    expect(gatewaySource).not.toContain("app.openapi(traverseGraphRoute");
    expect(handlersSource).not.toContain('from "./index"');
    expect(handlersSource).toContain("export function registerGraphHandlers");
  });

  it("keeps query route definitions outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const routesSource = readFileSync(resolve(import.meta.dirname, "query-routes.ts"), "utf8");

    expect(gatewaySource).toContain('export * from "./query-routes"');
    expect(gatewaySource).not.toContain("const streamQueryRoute = createRoute");
    expect(routesSource).not.toContain('from "./index"');
    expect(routesSource).toContain("export const streamQueryRoute");
  });

  it("keeps query handler registration outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const handlersSource = readFileSync(resolve(import.meta.dirname, "query-handlers.ts"), "utf8");

    expect(gatewaySource).toContain('export * from "./query-handlers"');
    expect(gatewaySource).toContain("registerQueryHandlers({");
    expect(gatewaySource).not.toContain("app.openapi(streamQueryRoute");
    expect(handlersSource).not.toContain('from "./index"');
    expect(handlersSource).toContain("export function registerQueryHandlers");
  });

  it("keeps KnowledgeFS route definitions outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const routesSource = readFileSync(
      resolve(import.meta.dirname, "knowledge-fs-routes.ts"),
      "utf8",
    );

    expect(gatewaySource).toContain('export * from "./knowledge-fs-routes"');
    expect(gatewaySource).not.toContain("const listKnowledgeFsRoute = createRoute");
    expect(gatewaySource).not.toContain("const grepKnowledgeFsRoute = createRoute");
    expect(gatewaySource).not.toContain("const diffKnowledgeFsRoute = createRoute");
    expect(gatewaySource).not.toContain("const statKnowledgeFsRoute = createRoute");
    expect(routesSource).not.toContain('from "./index"');
    expect(routesSource).toContain("export const listKnowledgeFsRoute");
  });

  it("keeps KnowledgeFS handler registration outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const handlersSource = readFileSync(
      resolve(import.meta.dirname, "knowledge-fs-handlers.ts"),
      "utf8",
    );

    expect(gatewaySource).toContain('export * from "./knowledge-fs-handlers"');
    expect(gatewaySource).toContain("registerKnowledgeFsHandlers({");
    expect(gatewaySource).not.toContain("app.openapi(listKnowledgeFsRoute");
    expect(gatewaySource).not.toContain("app.openapi(grepKnowledgeFsRoute");
    expect(gatewaySource).not.toContain("app.openapi(diffKnowledgeFsRoute");
    expect(gatewaySource).not.toContain("app.openapi(statKnowledgeFsRoute");
    expect(handlersSource).not.toContain('from "./index"');
    expect(handlersSource).toContain("export function registerKnowledgeFsHandlers");
  });

  it("keeps document compilation worker logic outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const workerSource = readFileSync(
      resolve(import.meta.dirname, "document-compilation-worker.ts"),
      "utf8",
    );

    expect(gatewaySource).toContain('export * from "./document-compilation-worker"');
    expect(gatewaySource).not.toContain("export function createDocumentCompilationWorker");
    expect(gatewaySource).not.toContain("const DocumentCompilationPayloadSchema");
    expect(gatewaySource).not.toContain("export function createIngestionSmokeEvaluationGate");
    expect(workerSource).not.toContain('from "./index"');
    expect(workerSource).toContain("export function createDocumentCompilationWorker");
  });

  it("keeps embedding model upgrade workflow outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const workflowSource = readFileSync(
      resolve(import.meta.dirname, "embedding-model-upgrade-workflow.ts"),
      "utf8",
    );

    expect(gatewaySource).toContain('export * from "./embedding-model-upgrade-workflow"');
    expect(gatewaySource).not.toContain("export function createEmbeddingModelUpgradeWorkflow");
    expect(gatewaySource).not.toContain("function validateRunEmbeddingModelUpgradeInput");
    expect(gatewaySource).not.toContain("function embeddingModelUpgradeIdempotencyKey");
    expect(workflowSource).not.toContain('from "./index"');
    expect(workflowSource).toContain("export function createEmbeddingModelUpgradeWorkflow");
  });

  it("keeps contextual enrichment flow outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const flowSource = readFileSync(
      resolve(import.meta.dirname, "contextual-enrichment-flow.ts"),
      "utf8",
    );

    expect(gatewaySource).toContain('export * from "./contextual-enrichment-flow"');
    expect(gatewaySource).not.toContain("export function createContextualEnrichmentFlow");
    expect(gatewaySource).not.toContain("function contextualEnrichmentCacheKey");
    expect(gatewaySource).not.toContain("function contextualEnrichmentPrompt");
    expect(flowSource).not.toContain('from "./index"');
    expect(flowSource).toContain("export function createContextualEnrichmentFlow");
  });

  it("keeps entity extraction flow outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const flowSource = readFileSync(
      resolve(import.meta.dirname, "entity-extraction-flow.ts"),
      "utf8",
    );

    expect(gatewaySource).toContain('export * from "./entity-extraction-flow"');
    expect(gatewaySource).not.toContain("export function createEntityExtractionFlow");
    expect(gatewaySource).not.toContain("function validateEntityExtractionInput");
    expect(gatewaySource).not.toContain("function entityExtractionPrompt");
    expect(flowSource).not.toContain('from "./index"');
    expect(flowSource).toContain("export function createEntityExtractionFlow");
  });

  it("keeps relation extraction flow outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const flowSource = readFileSync(
      resolve(import.meta.dirname, "relation-extraction-flow.ts"),
      "utf8",
    );

    expect(gatewaySource).toContain('export * from "./relation-extraction-flow"');
    expect(gatewaySource).not.toContain("export function createRelationExtractionFlow");
    expect(gatewaySource).not.toContain("function validateRelationExtractionInput");
    expect(gatewaySource).not.toContain("function relationExtractionPrompt");
    expect(flowSource).not.toContain('from "./index"');
    expect(flowSource).toContain("export function createRelationExtractionFlow");
  });

  it("keeps extraction quality control flow outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const flowSource = readFileSync(
      resolve(import.meta.dirname, "extraction-quality-control-flow.ts"),
      "utf8",
    );

    expect(gatewaySource).toContain('export * from "./extraction-quality-control-flow"');
    expect(gatewaySource).not.toContain("export function createExtractionQualityControlFlow");
    expect(gatewaySource).not.toContain("function validateExtractionQualityControlOptions");
    expect(gatewaySource).not.toContain("function applyEntityQualityControls");
    expect(flowSource).not.toContain('from "./index"');
    expect(flowSource).toContain("export function createExtractionQualityControlFlow");
  });

  it("keeps topic view materializer outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const materializerSource = readFileSync(
      resolve(import.meta.dirname, "topic-view-materializer.ts"),
      "utf8",
    );

    expect(gatewaySource).toContain('export * from "./topic-view-materializer"');
    expect(gatewaySource).not.toContain("export function createKnowledgeFsTopicViewMaterializer");
    expect(gatewaySource).not.toContain("function validateTopicViewMaterializerBounds");
    expect(gatewaySource).not.toContain("function validateSemanticTopicClusters");
    expect(materializerSource).not.toContain('from "./index"');
    expect(materializerSource).toContain("export function createKnowledgeFsTopicViewMaterializer");
  });

  it("keeps graph traversal responses outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const responseSource = readFileSync(
      resolve(import.meta.dirname, "graph-traversal-responses.ts"),
      "utf8",
    );

    expect(gatewaySource).toContain('export * from "./graph-traversal-responses"');
    expect(gatewaySource).not.toContain("function graphTraversalResponse");
    expect(gatewaySource).not.toContain("const GraphTraversalResponseSchema");
    expect(responseSource).not.toContain('from "./index"');
    expect(responseSource).toContain("export function graphTraversalResponse");
  });

  it("keeps shared API utility helpers outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const utilsSource = readFileSync(resolve(import.meta.dirname, "api-shared-utils.ts"), "utf8");

    expect(gatewaySource).toContain('export * from "./api-shared-utils"');
    expect(gatewaySource).not.toContain("function deterministicChildId");
    expect(gatewaySource).not.toContain("function cloneEvidenceBundle");
    expect(gatewaySource).not.toContain("function cloneTextDiffOperation");
    expect(utilsSource).not.toContain('from "./index"');
    expect(utilsSource).toContain("export function deterministicChildId");
  });

  it("keeps KnowledgeFS response schemas outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const schemaSource = readFileSync(
      resolve(import.meta.dirname, "knowledge-fs-response-schemas.ts"),
      "utf8",
    );

    expect(gatewaySource).toContain('export * from "./knowledge-fs-response-schemas"');
    expect(gatewaySource).not.toContain("const KnowledgeFsEntryResponseSchema");
    expect(gatewaySource).not.toContain("const KnowledgeFsDiffResponseSchema");
    expect(gatewaySource).not.toContain("const SemanticDiffSummarySchema");
    expect(schemaSource).not.toContain('from "./index"');
    expect(schemaSource).toContain("export const KnowledgeFsDiffResponseSchema");
  });

  it("keeps document response schemas outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const schemaSource = readFileSync(
      resolve(import.meta.dirname, "document-response-schemas.ts"),
      "utf8",
    );

    expect(gatewaySource).toContain('export * from "./document-response-schemas"');
    expect(gatewaySource).not.toContain("const DocumentUploadAcceptedResponseSchema");
    expect(gatewaySource).not.toContain("const BulkDocumentReindexResponseSchema");
    expect(gatewaySource).not.toContain("const DocumentCompilationJobResponseSchema");
    expect(schemaSource).not.toContain('from "./index"');
    expect(schemaSource).toContain("export const DocumentCompilationJobResponseSchema");
  });

  it("keeps research task response schemas outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const schemaSource = readFileSync(
      resolve(import.meta.dirname, "research-task-response-schemas.ts"),
      "utf8",
    );

    expect(gatewaySource).toContain('export * from "./research-task-response-schemas"');
    expect(gatewaySource).not.toContain("const ResearchTaskJobResponseSchema");
    expect(gatewaySource).not.toContain("const ResearchTaskPartialResultResponseSchema");
    expect(gatewaySource).not.toContain("const ResearchTaskDryRunPlanResponseSchema");
    expect(schemaSource).not.toContain('from "./index"');
    expect(schemaSource).toContain("export const ResearchTaskJobResponseSchema");
  });

  it("keeps operation and policy response schemas outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const schemaSource = readFileSync(
      resolve(import.meta.dirname, "operation-policy-response-schemas.ts"),
      "utf8",
    );

    expect(gatewaySource).toContain('export * from "./operation-policy-response-schemas"');
    expect(gatewaySource).not.toContain("const BulkOperationProgressResponseSchema");
    expect(gatewaySource).not.toContain("const RetentionPolicyResponseSchema");
    expect(schemaSource).not.toContain('from "./index"');
    expect(schemaSource).toContain("export const BulkOperationProgressResponseSchema");
  });

  it("keeps core resource response schemas outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const schemaSource = readFileSync(
      resolve(import.meta.dirname, "core-resource-response-schemas.ts"),
      "utf8",
    );

    expect(gatewaySource).toContain('export * from "./core-resource-response-schemas"');
    expect(gatewaySource).not.toContain("const GoldenQuestionResponseSchema");
    expect(gatewaySource).not.toContain("const KnowledgeSpaceResponseSchema");
    expect(gatewaySource).not.toContain("const ParseArtifactResponseSchema");
    expect(gatewaySource).not.toContain("const AnswerTraceResponseSchema");
    expect(schemaSource).not.toContain('from "./index"');
    expect(schemaSource).toContain("export const KnowledgeSpaceResponseSchema");
  });

  it("keeps knowledge-space and golden-question request schemas outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const schemaSource = readFileSync(
      resolve(import.meta.dirname, "knowledge-space-golden-question-schemas.ts"),
      "utf8",
    );

    expect(gatewaySource).toContain('export * from "./knowledge-space-golden-question-schemas"');
    expect(gatewaySource).not.toContain("const CreateKnowledgeSpaceSchema");
    expect(gatewaySource).not.toContain("const UpdateKnowledgeSpaceSchema");
    expect(gatewaySource).not.toContain("const CreateGoldenQuestionSchema");
    expect(gatewaySource).not.toContain("const AnnotateGoldenQuestionSchema");
    expect(schemaSource).not.toContain('from "./index"');
    expect(schemaSource).toContain("export const CreateKnowledgeSpaceSchema");
  });

  it("keeps research task request schemas outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const schemaSource = readFileSync(
      resolve(import.meta.dirname, "research-task-request-schemas.ts"),
      "utf8",
    );

    expect(gatewaySource).toContain('export * from "./research-task-request-schemas"');
    expect(gatewaySource).not.toContain("const CreateResearchTaskSchema");
    expect(gatewaySource).not.toContain("const PlanResearchTaskSchema");
    expect(gatewaySource).not.toContain("const ResearchTaskJobParamsSchema");
    expect(gatewaySource).not.toContain("const ListResearchTaskPartialsQuerySchema");
    expect(schemaSource).not.toContain('from "./index"');
    expect(schemaSource).toContain("export const CreateResearchTaskSchema");
  });

  it("keeps document request schemas outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const schemaSource = readFileSync(
      resolve(import.meta.dirname, "document-request-schemas.ts"),
      "utf8",
    );

    expect(gatewaySource).toContain('export * from "./document-request-schemas"');
    expect(gatewaySource).not.toContain("const DocumentUploadParamsSchema");
    expect(gatewaySource).not.toContain("const DocumentAssetParamsSchema");
    expect(gatewaySource).not.toContain("const BulkDocumentDeleteBodySchema");
    expect(gatewaySource).not.toContain("const BulkDocumentReindexBodySchema");
    expect(schemaSource).not.toContain('from "./index"');
    expect(schemaSource).toContain("export const DocumentUploadBodySchema");
  });

  it("keeps KnowledgeFS request and command schemas outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const schemaSource = readFileSync(
      resolve(import.meta.dirname, "knowledge-fs-request-schemas.ts"),
      "utf8",
    );

    expect(gatewaySource).toContain('export * from "./knowledge-fs-request-schemas"');
    expect(gatewaySource).not.toContain("const KnowledgeFsPathQuerySchema");
    expect(gatewaySource).not.toContain("const KnowledgeFsCommandInputSchema");
    expect(gatewaySource).not.toContain("const KnowledgeFsDiffCommandInputSchema");
    expect(schemaSource).not.toContain('from "./index"');
    expect(schemaSource).toContain("export const KnowledgeFsPathQuerySchema");
  });

  it("keeps shared gateway route schemas outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const schemaSource = readFileSync(
      resolve(import.meta.dirname, "gateway-route-schemas.ts"),
      "utf8",
    );

    expect(gatewaySource).toContain('export * from "./gateway-route-schemas"');
    expect(gatewaySource).not.toContain("const ErrorResponseSchema");
    expect(gatewaySource).not.toContain("const QueryStreamRequestSchema");
    expect(gatewaySource).not.toContain("const GraphTraverseQuerySchema");
    expect(schemaSource).not.toContain('from "./index"');
    expect(schemaSource).toContain("export const ErrorResponseSchema");
  });

  it("keeps Knowledge MCP contracts outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const mcpSource = readFileSync(resolve(import.meta.dirname, "knowledge-mcp-types.ts"), "utf8");

    expect(gatewaySource).toContain('export * from "./knowledge-mcp-types"');
    expect(gatewaySource).not.toContain("export type KnowledgeMcpToolName");
    expect(gatewaySource).not.toContain("export interface KnowledgeMcpServerOptions");
    expect(gatewaySource).not.toContain("const KNOWLEDGE_MCP_TOOLS");
    expect(mcpSource).not.toContain('from "./index"');
    expect(mcpSource).toContain("export interface KnowledgeMcpServerOptions");
  });

  it("keeps agent workspace snapshot schemas outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const schemaSource = readFileSync(
      resolve(import.meta.dirname, "agent-workspace-snapshot-schemas.ts"),
      "utf8",
    );

    expect(gatewaySource).toContain('export * from "./agent-workspace-snapshot-schemas"');
    expect(gatewaySource).not.toContain("const AgentWorkspaceSnapshotCommandSchema");
    expect(gatewaySource).not.toContain("const AgentWorkspaceSnapshotResponseSchema");
    expect(gatewaySource).not.toContain("const CreateAgentWorkspaceSnapshotRequestSchema");
    expect(schemaSource).not.toContain('from "./index"');
    expect(schemaSource).toContain("export const AgentWorkspaceSnapshotResponseSchema");
  });

  it("keeps Knowledge MCP server construction outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const mcpServerSource = readFileSync(
      resolve(import.meta.dirname, "knowledge-mcp-server.ts"),
      "utf8",
    );

    expect(gatewaySource).toContain('export * from "./knowledge-mcp-server"');
    expect(gatewaySource).not.toContain("export function createKnowledgeMcpServer");
    expect(gatewaySource).not.toContain("class KnowledgeMcpConfigurationError");
    expect(gatewaySource).not.toContain("const KnowledgeMcpFsListInputSchema");
    expect(mcpServerSource).not.toContain('from "./index"');
    expect(mcpServerSource).toContain("export function createKnowledgeMcpServer");
  });

  it("keeps job payload JSON compatibility helpers outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const jobPayloadSource = readFileSync(
      resolve(import.meta.dirname, "job-payload-utils.ts"),
      "utf8",
    );

    expect(gatewaySource).toContain('export * from "./job-payload-utils"');
    expect(gatewaySource).not.toContain("function toJobPayloadRecord");
    expect(gatewaySource).not.toContain("function isJobPayloadRecord");
    expect(jobPayloadSource).toContain("export function toJobPayloadRecord");
  });

  it("keeps route classification helpers outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const routeClassificationSource = readFileSync(
      resolve(import.meta.dirname, "route-classification.ts"),
      "utf8",
    );

    expect(gatewaySource).toContain('export * from "./route-classification"');
    expect(gatewaySource).not.toContain("function getTraceRoute");
    expect(gatewaySource).not.toContain("function getRateLimitTool");
    expect(routeClassificationSource).toContain("export function getTraceRoute");
  });

  it("keeps HTTP tracing middleware helpers outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const httpTracingSource = readFileSync(resolve(import.meta.dirname, "http-tracing.ts"), "utf8");

    expect(gatewaySource).toContain('export * from "./http-tracing"');
    expect(gatewaySource).not.toContain("function createTraceMiddleware");
    expect(gatewaySource).not.toContain("function normalizeTraceId");
    expect(httpTracingSource).toContain("export function createTraceMiddleware");
  });

  it("keeps rate limiter implementations and middleware outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const rateLimitSource = readFileSync(resolve(import.meta.dirname, "rate-limit.ts"), "utf8");

    expect(gatewaySource).toContain('export * from "./rate-limit"');
    expect(gatewaySource).not.toContain("export function createInMemoryRateLimiter");
    expect(gatewaySource).not.toContain("function createRateLimitMiddleware");
    expect(rateLimitSource).toContain("export function createInMemoryRateLimiter");
  });

  it("keeps default parser and compute runtime assembly outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const gatewayDefaultsSource = readFileSync(
      resolve(import.meta.dirname, "gateway-defaults.ts"),
      "utf8",
    );

    expect(gatewaySource).toContain('export * from "./gateway-defaults"');
    expect(gatewaySource).not.toContain("function createDefaultParser");
    expect(gatewaySource).not.toContain("function createDefaultComputeRuntime");
    expect(gatewayDefaultsSource).toContain("export function createDefaultParser");
    expect(gatewayDefaultsSource).toContain("export function createDefaultComputeRuntime");
  });

  it("keeps storage path helpers outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const storagePathSource = readFileSync(
      resolve(import.meta.dirname, "storage-path-utils.ts"),
      "utf8",
    );

    expect(gatewaySource).toContain('export * from "./storage-path-utils"');
    expect(gatewaySource).not.toContain("function sourceObjectKeyForPath");
    expect(gatewaySource).not.toContain("function sanitizeFilename");
    expect(storagePathSource).toContain("export function sourceObjectKeyForPath");
  });

  it("keeps cursor codecs and validation error outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const cursorSource = readFileSync(resolve(import.meta.dirname, "cursor-utils.ts"), "utf8");

    expect(gatewaySource).toContain('export * from "./cursor-utils"');
    expect(gatewaySource).not.toContain("function encodeGraphEntityCursor");
    expect(gatewaySource).not.toContain("class KnowledgeFsValidationError");
    expect(cursorSource).toContain("export function encodeGraphEntityCursor");
  });

  it("keeps KnowledgeFS shared errors outside feature-specific utility modules", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const cursorSource = readFileSync(resolve(import.meta.dirname, "cursor-utils.ts"), "utf8");
    const errorsSource = readFileSync(
      resolve(import.meta.dirname, "knowledge-fs-errors.ts"),
      "utf8",
    );

    expect(gatewaySource).toContain('export * from "./knowledge-fs-errors"');
    expect(gatewaySource).not.toContain("class KnowledgeFsNotFoundError");
    expect(cursorSource).not.toContain("class KnowledgeFsValidationError");
    expect(errorsSource).toContain("export class KnowledgeFsValidationError");
    expect(errorsSource).toContain("export class KnowledgeFsNotFoundError");
  });

  it("keeps KnowledgeFS path helpers outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const pathSource = readFileSync(
      resolve(import.meta.dirname, "knowledge-fs-path-utils.ts"),
      "utf8",
    );

    expect(gatewaySource).toContain('export * from "./knowledge-fs-path-utils"');
    expect(gatewaySource).not.toContain("function normalizeKnowledgeFsPath");
    expect(gatewaySource).not.toContain("function parseKnowledgeFsPhysicalPath");
    expect(pathSource).toContain("export function normalizeKnowledgeFsPath");
  });

  it("keeps document upload parsing and hashing outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const uploadSource = readFileSync(
      resolve(import.meta.dirname, "document-upload-utils.ts"),
      "utf8",
    );

    expect(gatewaySource).toContain('export * from "./document-upload-utils"');
    expect(gatewaySource).not.toContain("function readDocumentUpload");
    expect(gatewaySource).not.toContain("async function sha256Hex");
    expect(uploadSource).toContain("export async function readDocumentUpload");
  });

  it("keeps storage quota policies and enforcement outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const quotaSource = readFileSync(resolve(import.meta.dirname, "storage-quota.ts"), "utf8");

    expect(gatewaySource).toContain('export * from "./storage-quota"');
    expect(gatewaySource).not.toContain("function createStaticStorageQuotaRepository");
    expect(gatewaySource).not.toContain("async function enforceStorageQuota");
    expect(quotaSource).toContain("export async function enforceStorageQuota");
  });

  it("keeps gateway component health aggregation outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const healthSource = readFileSync(resolve(import.meta.dirname, "gateway-health.ts"), "utf8");

    expect(gatewaySource).toContain('export * from "./gateway-health"');
    expect(gatewaySource).not.toContain("async function collectGatewayComponentHealth");
    expect(gatewaySource).not.toContain("async function checkGatewayComponentHealth");
    expect(healthSource).toContain("export async function collectGatewayComponentHealth");
  });

  it("keeps OpenAPI handler casting helpers outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const openApiSource = readFileSync(
      resolve(import.meta.dirname, "openapi-handler-utils.ts"),
      "utf8",
    );

    expect(gatewaySource).toContain('export * from "./openapi-handler-utils"');
    expect(gatewaySource).not.toContain("function asLooseOpenApiContext");
    expect(gatewaySource).not.toContain("function openApiHandler");
    expect(openApiSource).toContain("export function openApiHandler");
  });

  it("keeps safe-shell parsing and transforms outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const safeShellSource = readFileSync(resolve(import.meta.dirname, "safe-shell.ts"), "utf8");

    expect(gatewaySource).toContain('export * from "./safe-shell"');
    expect(gatewaySource).not.toContain("function tokenizeSafeShellCommand");
    expect(gatewaySource).not.toContain("function applySafeShellTransform");
    expect(safeShellSource).toContain("export function createSafeShell");
  });

  it("keeps retention policy repositories and cleanup workers outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const retentionSource = readFileSync(
      resolve(import.meta.dirname, "retention-policy.ts"),
      "utf8",
    );

    expect(gatewaySource).toContain('export * from "./retention-policy"');
    expect(gatewaySource).not.toContain("function defaultRetentionPolicy");
    expect(gatewaySource).not.toContain("function validateRetentionPolicyPatch");
    expect(gatewaySource).not.toContain("function validateKnowledgeSpaceRetentionCleanupPayload");
    expect(retentionSource).toContain("export function createInMemoryRetentionPolicyRepository");
  });

  it("does not publicly expose legacy synchronous document-deletion bypasses", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");

    expect(gatewaySource).not.toContain('export * from "./document-cascade-delete"');
    expect(gatewaySource).not.toContain('export * from "./document-deletion-lifecycle"');
    expect(gatewaySource).not.toContain('export * from "./source-document-deleter"');
  });

  it("keeps bulk operation repositories outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const bulkOperationSource = readFileSync(
      resolve(import.meta.dirname, "bulk-operation.ts"),
      "utf8",
    );

    expect(gatewaySource).toContain('export * from "./bulk-operation"');
    expect(gatewaySource).not.toContain("function cloneBulkOperation");
    expect(gatewaySource).not.toContain("export function createInMemoryBulkOperationRepository");
    expect(bulkOperationSource).toContain("export function createInMemoryBulkOperationRepository");
  });

  it("keeps parse artifact repositories outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const parseArtifactSource = readFileSync(
      resolve(import.meta.dirname, "parse-artifact-repository.ts"),
      "utf8",
    );

    expect(gatewaySource).toContain('export * from "./parse-artifact-repository"');
    expect(gatewaySource).not.toContain("function parseArtifactKey");
    expect(gatewaySource).not.toContain("export function createInMemoryParseArtifactRepository");
    expect(gatewaySource).not.toContain("export function createDatabaseParseArtifactRepository");
    expect(parseArtifactSource).toContain("export function createInMemoryParseArtifactRepository");
  });

  it("keeps resource mount repositories outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const resourceMountSource = readFileSync(
      resolve(import.meta.dirname, "resource-mount-repository.ts"),
      "utf8",
    );

    expect(gatewaySource).toContain('export * from "./resource-mount-repository"');
    expect(gatewaySource).not.toContain("function cloneResourceMount");
    expect(gatewaySource).not.toContain("export function createInMemoryResourceMountRepository");
    expect(resourceMountSource).toContain("export function createInMemoryResourceMountRepository");
  });

  it("keeps golden question repositories outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const goldenQuestionSource = readFileSync(
      resolve(import.meta.dirname, "golden-question-repository.ts"),
      "utf8",
    );

    expect(gatewaySource).toContain('export * from "./golden-question-repository"');
    expect(gatewaySource).not.toContain("function cloneGoldenQuestion");
    expect(gatewaySource).not.toContain("function mapGoldenQuestionRow");
    expect(gatewaySource).not.toContain("export function createInMemoryGoldenQuestionRepository");
    expect(gatewaySource).not.toContain("export function createDatabaseGoldenQuestionRepository");
    expect(goldenQuestionSource).toContain(
      "export function createInMemoryGoldenQuestionRepository",
    );
    expect(goldenQuestionSource).toContain(
      "export function createDatabaseGoldenQuestionRepository",
    );
  });

  it("keeps embedding model registries outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const embeddingModelSource = readFileSync(
      resolve(import.meta.dirname, "embedding-model-registry.ts"),
      "utf8",
    );

    expect(gatewaySource).toContain('export * from "./embedding-model-registry"');
    expect(gatewaySource).not.toContain("function cloneEmbeddingModel");
    expect(gatewaySource).not.toContain("function mapEmbeddingModelRow");
    expect(gatewaySource).not.toContain("export function createInMemoryEmbeddingModelRegistry");
    expect(gatewaySource).not.toContain("export function createDatabaseEmbeddingModelRegistry");
    expect(embeddingModelSource).toContain("export function createInMemoryEmbeddingModelRegistry");
    expect(embeddingModelSource).toContain("export function createDatabaseEmbeddingModelRegistry");
  });

  it("keeps answer trace recorder assembly outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const answerTraceRecorderSource = readFileSync(
      resolve(import.meta.dirname, "answer-trace-recorder.ts"),
      "utf8",
    );

    expect(gatewaySource).toContain('export * from "./answer-trace-recorder"');
    expect(gatewaySource).not.toContain("export function createAnswerTraceRecorder");
    expect(answerTraceRecorderSource).toContain("export function createAnswerTraceRecorder");
  });

  it("keeps answer trace repositories outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const answerTraceRepositorySource = readFileSync(
      resolve(import.meta.dirname, "answer-trace-repository.ts"),
      "utf8",
    );

    expect(gatewaySource).toContain('export * from "./answer-trace-repository"');
    expect(gatewaySource).not.toContain("export function createInMemoryAnswerTraceRepository");
    expect(gatewaySource).not.toContain("export function createDatabaseAnswerTraceRepository");
    expect(answerTraceRepositorySource).toContain(
      "export function createInMemoryAnswerTraceRepository",
    );
    expect(answerTraceRepositorySource).toContain(
      "export function createDatabaseAnswerTraceRepository",
    );
  });

  it("keeps document asset repositories outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const documentAssetRepositorySource = readFileSync(
      resolve(import.meta.dirname, "document-asset-repository.ts"),
      "utf8",
    );

    expect(gatewaySource).toContain('export * from "./document-asset-repository"');
    expect(gatewaySource).not.toContain("export function createInMemoryDocumentAssetRepository");
    expect(gatewaySource).not.toContain("export function createDatabaseDocumentAssetRepository");
    expect(documentAssetRepositorySource).toContain(
      "export function createInMemoryDocumentAssetRepository",
    );
    expect(documentAssetRepositorySource).toContain(
      "export function createDatabaseDocumentAssetRepository",
    );
  });

  it("keeps knowledge space repositories outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const knowledgeSpaceRepositorySource = readFileSync(
      resolve(import.meta.dirname, "knowledge-space-repository.ts"),
      "utf8",
    );

    expect(gatewaySource).toContain('export * from "./knowledge-space-repository"');
    expect(gatewaySource).not.toContain("export function createInMemoryKnowledgeSpaceRepository");
    expect(gatewaySource).not.toContain("export function createDatabaseKnowledgeSpaceRepository");
    expect(knowledgeSpaceRepositorySource).toContain(
      "export function createInMemoryKnowledgeSpaceRepository",
    );
    expect(knowledgeSpaceRepositorySource).toContain(
      "export function createDatabaseKnowledgeSpaceRepository",
    );
  });

  it("keeps session context repositories outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const sessionContextRepositorySource = readFileSync(
      resolve(import.meta.dirname, "session-context-repository.ts"),
      "utf8",
    );

    expect(gatewaySource).toContain('export * from "./session-context-repository"');
    expect(gatewaySource).not.toContain("export function createCacheSessionContextRepository");
    expect(sessionContextRepositorySource).toContain(
      "export function createCacheSessionContextRepository",
    );
  });

  it("keeps knowledge path repositories outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const knowledgePathRepositorySource = readFileSync(
      resolve(import.meta.dirname, "knowledge-path-repository.ts"),
      "utf8",
    );

    expect(gatewaySource).toContain('export * from "./knowledge-path-repository"');
    expect(gatewaySource).not.toContain("export function createInMemoryKnowledgePathRepository");
    expect(knowledgePathRepositorySource).toContain(
      "export function createInMemoryKnowledgePathRepository",
    );
  });

  it("keeps knowledge node repositories outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const knowledgeNodeRepositorySource = readFileSync(
      resolve(import.meta.dirname, "knowledge-node-repository.ts"),
      "utf8",
    );

    expect(gatewaySource).toContain('export * from "./knowledge-node-repository"');
    expect(gatewaySource).not.toContain("export function createInMemoryKnowledgeNodeRepository");
    expect(knowledgeNodeRepositorySource).toContain(
      "export function createInMemoryKnowledgeNodeRepository",
    );
  });

  it("keeps knowledge path resolution cache outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const pathResolutionCacheSource = readFileSync(
      resolve(import.meta.dirname, "knowledge-path-resolution-cache.ts"),
      "utf8",
    );

    expect(gatewaySource).toContain('export * from "./knowledge-path-resolution-cache"');
    expect(gatewaySource).not.toContain("export function createKnowledgePathResolutionCache");
    expect(pathResolutionCacheSource).toContain(
      "export function createKnowledgePathResolutionCache",
    );
  });

  it("keeps retrieval text normalization outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const retrievalTextSource = readFileSync(
      resolve(import.meta.dirname, "retrieval-text-utils.ts"),
      "utf8",
    );

    expect(gatewaySource).toContain('export * from "./retrieval-text-utils"');
    expect(gatewaySource).not.toContain("export function normalizeMixedLanguageFtsText");
    expect(gatewaySource).not.toContain("function detectRetrievalQueryLanguage");
    expect(retrievalTextSource).toContain("export function normalizeMixedLanguageFtsText");
    expect(retrievalTextSource).toContain("export function detectRetrievalQueryLanguage");
  });

  it("keeps index projection repositories outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const indexProjectionSource = readFileSync(
      resolve(import.meta.dirname, "index-projection-repository.ts"),
      "utf8",
    );

    expect(gatewaySource).toContain('export * from "./index-projection-repository"');
    expect(gatewaySource).not.toContain("export function createInMemoryIndexProjectionRepository");
    expect(gatewaySource).not.toContain("export function createDatabaseIndexProjectionRepository");
    expect(gatewaySource).not.toContain("function mapIndexProjectionRow");
    expect(indexProjectionSource).toContain(
      "export function createInMemoryIndexProjectionRepository",
    );
    expect(indexProjectionSource).toContain(
      "export function createDatabaseIndexProjectionRepository",
    );
  });

  it("keeps index projection builders outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const builderSource = readFileSync(
      resolve(import.meta.dirname, "index-projection-builders.ts"),
      "utf8",
    );

    expect(gatewaySource).toContain('export * from "./index-projection-builders"');
    expect(gatewaySource).not.toContain("export function createDenseVectorProjectionBuilder");
    expect(gatewaySource).not.toContain("export function createFtsProjectionBuilder");
    expect(gatewaySource).not.toContain("function validateDenseVectorProjectionBatch");
    expect(builderSource).toContain("export function createDenseVectorProjectionBuilder");
    expect(builderSource).toContain("export function createFtsProjectionBuilder");
  });

  it("keeps incremental reindexing outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const reindexerSource = readFileSync(
      resolve(import.meta.dirname, "index-reindexer.ts"),
      "utf8",
    );

    expect(gatewaySource).toContain('export * from "./index-reindexer"');
    expect(gatewaySource).not.toContain("export function createIncrementalReindexer");
    expect(gatewaySource).not.toContain("function validateIncrementalReindexInput");
    expect(reindexerSource).toContain("export function createIncrementalReindexer");
  });

  it("keeps retrieval candidate helpers outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const retrievalCandidatesSource = readFileSync(
      resolve(import.meta.dirname, "retrieval-candidates.ts"),
      "utf8",
    );

    expect(gatewaySource).toContain('export * from "./retrieval-candidates"');
    expect(gatewaySource).not.toContain("function mapRetrievalCandidateRow");
    expect(gatewaySource).not.toContain("function filterRetrievalCandidatesByMetadata");
    expect(gatewaySource).not.toContain("function filterRetrievalCandidatesByPermission");
    expect(retrievalCandidatesSource).toContain("export function mapRetrievalCandidateRow");
  });

  it("keeps retrieval fusion helpers outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const retrievalFusionSource = readFileSync(
      resolve(import.meta.dirname, "retrieval-fusion.ts"),
      "utf8",
    );

    expect(gatewaySource).toContain('export * from "./retrieval-fusion"');
    expect(gatewaySource).not.toContain("function fuseRetrievalCandidates");
    expect(gatewaySource).not.toContain("function fuseRetrievalCandidatesWithRuntime");
    expect(gatewaySource).not.toContain("function aggregateRetrievalCandidates");
    expect(retrievalFusionSource).toContain("export function fuseRetrievalCandidates");
  });

  it("keeps retrieval rerank helpers outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const retrievalRerankSource = readFileSync(
      resolve(import.meta.dirname, "retrieval-rerank.ts"),
      "utf8",
    );

    expect(gatewaySource).toContain('export * from "./retrieval-rerank"');
    expect(gatewaySource).not.toContain("function rerankHybridRetrievalItems");
    expect(gatewaySource).not.toContain("function rerankTextForHybridItem");
    expect(gatewaySource).not.toContain("function evidenceTextFromHybridItem");
    expect(retrievalRerankSource).toContain("export async function rerankHybridRetrievalItems");
  });

  it("keeps retrieval evidence mapping outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const retrievalEvidenceSource = readFileSync(
      resolve(import.meta.dirname, "retrieval-evidence.ts"),
      "utf8",
    );

    expect(gatewaySource).toContain('export * from "./retrieval-evidence"');
    expect(gatewaySource).not.toContain("function hybridRetrievalItemToEvidenceItem");
    expect(gatewaySource).not.toContain("function evidenceFreshnessFromMetadata");
    expect(gatewaySource).not.toContain("function evidenceConflictsFromMetadata");
    expect(retrievalEvidenceSource).toContain("export function hybridRetrievalItemToEvidenceItem");
  });

  it("keeps retrieval evaluation utility helpers outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const evaluationUtilsSource = readFileSync(
      resolve(import.meta.dirname, "retrieval-evaluation-utils.ts"),
      "utf8",
    );

    expect(gatewaySource).toContain('export * from "./retrieval-evaluation-utils"');
    expect(gatewaySource).not.toContain("function validateRetrievalEvaluationBounds");
    expect(gatewaySource).not.toContain("function validateAbRetrievalStrategies");
    expect(gatewaySource).not.toContain("function abRetrievalWinner");
    expect(evaluationUtilsSource).toContain("export function validateRetrievalEvaluationBounds");
  });

  it("keeps retrieval evaluation report helpers outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const reportSource = readFileSync(
      resolve(import.meta.dirname, "retrieval-evaluation-reports.ts"),
      "utf8",
    );

    expect(gatewaySource).toContain('export * from "./retrieval-evaluation-reports"');
    expect(gatewaySource).not.toContain("function retrievalEvaluationReportFromItems");
    expect(gatewaySource).not.toContain("function cloneRetrievalEvaluationReport");
    expect(gatewaySource).not.toContain("function zeroRetrievalEvaluationDelta");
    expect(reportSource).toContain("export function retrievalEvaluationReportFromItems");
  });

  it("keeps graph index repository implementations outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const graphRepositorySource = readFileSync(
      resolve(import.meta.dirname, "graph-index-repository.ts"),
      "utf8",
    );

    expect(gatewaySource).toContain('export * from "./graph-index-repository"');
    expect(gatewaySource).not.toContain("export function createInMemoryGraphIndexRepository");
    expect(gatewaySource).not.toContain("export function createDatabaseGraphIndexRepository");
    expect(gatewaySource).not.toContain("function graphTraversalSql");
    expect(graphRepositorySource).not.toContain('from "./index"');
    expect(graphRepositorySource).toContain("export function createInMemoryGraphIndexRepository");
  });

  it("keeps graph index writer and metadata extraction outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const graphWriterSource = readFileSync(
      resolve(import.meta.dirname, "graph-index-writer.ts"),
      "utf8",
    );

    expect(gatewaySource).toContain('export * from "./graph-index-writer"');
    expect(gatewaySource).not.toContain("export function createGraphIndexWriter");
    expect(gatewaySource).not.toContain("function graphEntitiesFromNodeMetadata");
    expect(gatewaySource).not.toContain("function graphRelationsFromNodeMetadata");
    expect(graphWriterSource).not.toContain('from "./index"');
    expect(graphWriterSource).toContain("export function createGraphIndexWriter");
  });

  it("keeps summary tree builders outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const summaryTreeSource = readFileSync(resolve(import.meta.dirname, "summary-tree.ts"), "utf8");

    expect(gatewaySource).toContain('export * from "./summary-tree"');
    expect(gatewaySource).not.toContain("export function createSummaryTreeBuilder");
    expect(gatewaySource).not.toContain("export function createSummaryTreeMaintenanceFlow");
    expect(gatewaySource).not.toContain("function generateSummaryTreeNode");
    expect(summaryTreeSource).not.toContain('from "./index"');
    expect(summaryTreeSource).toContain("export function createSummaryTreeBuilder");
  });

  it("keeps retrieval path builders outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const retrievalPathsSource = readFileSync(
      resolve(import.meta.dirname, "retrieval-paths.ts"),
      "utf8",
    );

    expect(gatewaySource).toContain('export * from "./retrieval-paths"');
    expect(gatewaySource).toContain('export * from "./retrieval-types"');
    expect(gatewaySource).not.toContain("export function createSummaryTreeRetrievalPath");
    expect(gatewaySource).not.toContain("export function createGraphExpandedRetrievalPath");
    expect(gatewaySource).not.toContain("function mergeGraphExpandedRetrievalItems");
    expect(retrievalPathsSource).not.toContain('from "./index"');
    expect(retrievalPathsSource).toContain("export function createSummaryTreeRetrievalPath");
  });

  it("keeps retrieval planner logic outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const retrievalPlannerSource = readFileSync(
      resolve(import.meta.dirname, "retrieval-planner.ts"),
      "utf8",
    );

    expect(gatewaySource).toContain('export * from "./retrieval-planner"');
    expect(gatewaySource).not.toContain("export function createRetrievalPlanner");
    expect(gatewaySource).not.toContain("function resolveAutoRetrievalMode");
    expect(gatewaySource).not.toContain("function defaultRetrievalPlan");
    expect(retrievalPlannerSource).not.toContain('from "./index"');
    expect(retrievalPlannerSource).toContain("export function createRetrievalPlanner");
  });

  it("keeps retrieval caches and filter normalization outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const retrievalCacheSource = readFileSync(
      resolve(import.meta.dirname, "retrieval-cache.ts"),
      "utf8",
    );
    const filterSource = readFileSync(
      resolve(import.meta.dirname, "retrieval-filter-utils.ts"),
      "utf8",
    );

    expect(gatewaySource).toContain('export * from "./retrieval-cache"');
    expect(gatewaySource).toContain('export * from "./retrieval-filter-utils"');
    expect(gatewaySource).not.toContain("export function createQueryNormalizationCache");
    expect(gatewaySource).not.toContain("export function createEvidenceBundleCache");
    expect(gatewaySource).not.toContain("function normalizeRetrievalMetadataFilters");
    expect(retrievalCacheSource).not.toContain('from "./index"');
    expect(filterSource).not.toContain('from "./index"');
    expect(retrievalCacheSource).toContain("export function createQueryNormalizationCache");
  });

  it("keeps evidence bundle assembly outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const assemblerSource = readFileSync(
      resolve(import.meta.dirname, "evidence-bundle-assembler.ts"),
      "utf8",
    );

    expect(gatewaySource).toContain('export * from "./evidence-bundle-assembler"');
    expect(gatewaySource).not.toContain("export function createEvidenceBundleAssembler");
    expect(gatewaySource).not.toContain("export function createAnswerabilityEvaluator");
    expect(assemblerSource).not.toContain('from "./index"');
    expect(assemblerSource).toContain("export function createEvidenceBundleAssembler");
  });

  it("keeps hybrid retrieval execution outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const hybridRetrievalSource = readFileSync(
      resolve(import.meta.dirname, "hybrid-retrieval.ts"),
      "utf8",
    );

    expect(gatewaySource).toContain('export * from "./hybrid-retrieval"');
    expect(gatewaySource).not.toContain("export function createDatabaseHybridRetrievalRepository");
    expect(gatewaySource).not.toContain("export function createBasicHybridRetriever");
    expect(hybridRetrievalSource).not.toContain('from "./index"');
    expect(hybridRetrievalSource).toContain(
      "export function createDatabaseHybridRetrievalRepository",
    );
    expect(hybridRetrievalSource).toContain("export function createBasicHybridRetriever");
  });

  it("keeps retrieval evaluation runners outside the gateway god file", () => {
    const gatewaySource = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const evaluationRunnerSource = readFileSync(
      resolve(import.meta.dirname, "retrieval-evaluation-runners.ts"),
      "utf8",
    );

    expect(gatewaySource).toContain('export * from "./retrieval-evaluation-runners"');
    expect(gatewaySource).not.toContain("export function createRetrievalEvaluationRunner");
    expect(gatewaySource).not.toContain("export function createAdvancedRetrievalEvaluationRunner");
    expect(gatewaySource).not.toContain("export function createRetrievalImpactEvaluationRunner");
    expect(evaluationRunnerSource).not.toContain('from "./index"');
    expect(evaluationRunnerSource).toContain("export function createRetrievalEvaluationRunner");
  });
});
