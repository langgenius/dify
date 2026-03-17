// src/lsp/css/setup.ts
import * as client from "../client.mjs";
async function setup(monaco, languageId, languageSettings, formattingOptions, workspace) {
  const validProperties = languageSettings?.validProperties;
  const dataProviders = { ...languageSettings?.dataProviders };
  if (validProperties) {
    dataProviders["#valid-properties"] = {
      version: 1.1,
      properties: validProperties.map((property) => ({ name: property }))
    };
  }
  const { tabSize, insertSpaces, insertFinalNewline, trimFinalNewlines } = formattingOptions ?? {};
  const createData = {
    language: languageId,
    data: {
      useDefaultDataProvider: languageSettings?.useDefaultDataProvider ?? true,
      dataProviders
    },
    format: {
      tabSize,
      insertFinalNewline,
      insertSpaces,
      preserveNewLines: !trimFinalNewlines,
      newlineBetweenSelectors: true,
      newlineBetweenRules: true,
      spaceAroundSelectorSeparator: false,
      braceStyle: "collapse"
    },
    fs: workspace ? await client.walkFS(workspace.fs, "/") : void 0
  };
  const worker = monaco.editor.createWebWorker({
    worker: getWorker(createData),
    host: client.createHost(workspace)
  });
  client.init(monaco);
  client.registerBasicFeatures(languageId, worker, ["/", "-", ":", "("], workspace, languageSettings?.diagnosticsOptions);
  client.registerCodeAction(languageId, worker);
  client.registerColorPresentation(languageId, worker);
  client.registerDocumentLinks(languageId, worker);
}
function createWebWorker() {
  const workerUrl = new URL("./worker.mjs", import.meta.url);
  if (workerUrl.origin !== location.origin) {
    return new Worker(
      URL.createObjectURL(new Blob([`import "${workerUrl.href}"`], { type: "application/javascript" })),
      { type: "module", name: "css-worker" }
    );
  }
  return new Worker(workerUrl, { type: "module", name: "css-worker" });
}
function getWorker(createData) {
  const worker = createWebWorker();
  worker.postMessage(createData);
  return worker;
}
export {
  setup
};
