// src/workspace.ts
import {
  createPersistStateStorage,
  createPersistTask,
  decode,
  encode,
  filenameToURL,
  normalizeURL,
  openIDB,
  openIDBCursor,
  promiseWithResolvers,
  promisifyIDBRequest,
  supportLocalStorage
} from "./util.mjs";
var NotFoundError = class extends Error {
  FS_ERROR = "NOT_FOUND";
  constructor(message) {
    super("No such file or directory: " + message);
  }
};
var Workspace = class {
  _monaco;
  _history;
  _fs;
  _viewState;
  _entryFile;
  constructor(options = {}) {
    const { name = "default", browserHistory, initialFiles, entryFile, customFS } = options;
    this._monaco = promiseWithResolvers();
    this._fs = customFS ?? new IndexedDBFileSystem("modern-monaco-workspace(" + name + ")");
    this._viewState = new WorkspaceStateStorage("modern-monaco-state(" + name + ")");
    this._entryFile = entryFile;
    if (initialFiles) {
      for (const [name2, data] of Object.entries(initialFiles)) {
        void this._fs.stat(name2).catch(async (err) => {
          if (err instanceof NotFoundError) {
            const { pathname } = filenameToURL(name2);
            const dir = pathname.slice(0, pathname.lastIndexOf("/"));
            if (dir) {
              await this._fs.createDirectory(dir);
            }
            await this._fs.writeFile(name2, data);
          } else {
            throw err;
          }
        });
      }
    }
    if (browserHistory) {
      if (!globalThis.history) {
        throw new Error("Browser history is not supported.");
      }
      this._history = new BrowserHistory(browserHistory === true ? "/" : browserHistory.basePath);
    } else {
      this._history = new LocalStorageHistory(name);
    }
  }
  setupMonaco(monaco) {
    this._monaco.resolve(monaco);
  }
  get entryFile() {
    return this._entryFile;
  }
  get fs() {
    return this._fs;
  }
  get history() {
    return this._history;
  }
  get viewState() {
    return this._viewState;
  }
  async openTextDocument(uri, content, editor) {
    const monaco = await this._monaco.promise;
    const getEditor = async () => {
      const editors = monaco.editor.getEditors();
      const editor2 = editors.find((e) => e.hasWidgetFocus() || e.hasTextFocus()) ?? editors[0];
      if (!editor2) {
        return new Promise((resolve) => setTimeout(() => resolve(getEditor()), 100));
      }
      return editor2;
    };
    return this._openTextDocument(monaco, editor ?? await getEditor(), uri, void 0, content);
  }
  async _openTextDocument(monaco, editor, uri, selectionOrPosition, readonlyContent) {
    const fs = this._fs;
    const href = normalizeURL(uri).href;
    const content = readonlyContent ?? await fs.readTextFile(href);
    const viewState = await this.viewState.get(href);
    const modelUri = monaco.Uri.parse(href);
    const model = monaco.editor.getModel(modelUri) ?? monaco.editor.createModel(content, void 0, modelUri);
    if (!Reflect.has(model, "__OB__") && typeof readonlyContent !== "string") {
      const persist = createPersistTask(() => fs.writeFile(href, model.getValue(), { isModelContentChange: true }));
      const disposable = model.onDidChangeContent(persist);
      const unwatch = fs.watch(href, (kind, _, __, context) => {
        if (kind === "modify" && (!context || !context.isModelContentChange)) {
          fs.readTextFile(href).then((content2) => {
            if (model.getValue() !== content2) {
              model.setValue(content2);
              model.pushStackElement();
            }
          });
        }
      });
      model.onWillDispose(() => {
        Reflect.deleteProperty(model, "__OB__");
        disposable.dispose();
        unwatch();
      });
      Reflect.set(model, "__OB__", true);
    }
    editor.setModel(model);
    editor.updateOptions({ readOnly: typeof readonlyContent === "string" });
    if (typeof readonlyContent === "string") {
      const disposable = editor.onDidChangeModel(() => {
        model.dispose();
        disposable.dispose();
      });
    }
    if (selectionOrPosition) {
      if ("startLineNumber" in selectionOrPosition) {
        editor.setSelection(selectionOrPosition);
      } else {
        editor.setPosition(selectionOrPosition);
      }
      const pos = editor.getPosition();
      if (pos) {
        const svp = editor.getScrolledVisiblePosition(new monaco.Position(pos.lineNumber - 7, pos.column));
        if (svp) {
          editor.setScrollTop(svp.top);
        }
      }
    } else if (viewState) {
      editor.restoreViewState(viewState);
    }
    if (this._history.state.current !== href) {
      this._history.push(href);
    }
    return model;
  }
  async showInputBox(options, token) {
    const monaco = await this._monaco.promise;
    return monaco.showInputBox(options, token);
  }
  async showQuickPick(items, options, token) {
    const monaco = await this._monaco.promise;
    return monaco.showQuickPick(items, options, token);
  }
};
var IndexedDBFileSystem = class {
  _watchers = /* @__PURE__ */ new Set();
  _db;
  constructor(scope) {
    this._db = new WorkspaceDatabase(
      scope,
      { name: "fs-meta", keyPath: "url" },
      { name: "fs-blob", keyPath: "url" }
    );
  }
  async _getIdbObjectStore(storeName, readwrite = false) {
    const db = await this._db.open();
    return db.transaction(storeName, readwrite ? "readwrite" : "readonly").objectStore(storeName);
  }
  async _getIdbObjectStores(readwrite = false) {
    const transaction = (await this._db.open()).transaction(["fs-meta", "fs-blob"], readwrite ? "readwrite" : "readonly");
    return [transaction.objectStore("fs-meta"), transaction.objectStore("fs-blob")];
  }
  async stat(name) {
    const url = filenameToURL(name).href;
    if (url === "file:///") {
      return { type: 2, version: 1, ctime: 0, mtime: 0, size: 0 };
    }
    const metaStore = await this._getIdbObjectStore("fs-meta");
    const stat = await promisifyIDBRequest(metaStore.get(url));
    if (!stat) {
      throw new NotFoundError(url);
    }
    return stat;
  }
  async createDirectory(name) {
    const { pathname, href: url } = filenameToURL(name);
    const metaStore = await this._getIdbObjectStore("fs-meta", true);
    const exists = (url2) => promisifyIDBRequest(metaStore.get(url2)).then(Boolean);
    if (await exists(url)) return;
    const now = Date.now();
    const promises = [];
    const newDirs = [];
    let parent = pathname.slice(0, pathname.lastIndexOf("/"));
    while (parent) {
      const parentUrl = filenameToURL(parent).href;
      if (!await exists(parentUrl)) {
        const stat2 = { type: 2, version: 1, ctime: now, mtime: now, size: 0 };
        promises.push(promisifyIDBRequest(metaStore.add({ url: parentUrl, ...stat2 })));
        newDirs.push(parent);
      }
      parent = parent.slice(0, parent.lastIndexOf("/"));
    }
    const stat = { type: 2, version: 1, ctime: now, mtime: now, size: 0 };
    promises.push(promisifyIDBRequest(metaStore.add({ url, ...stat })));
    newDirs.push(pathname);
    await Promise.all(promises);
    for (const dir of newDirs) {
      this._notify("create", dir, 2);
    }
  }
  async readDirectory(name) {
    const { pathname } = filenameToURL(name);
    const stat = await this.stat(name);
    if (stat.type !== 2) {
      throw new Error(`read ${pathname}: not a directory`);
    }
    const metaStore = await this._getIdbObjectStore("fs-meta");
    const entries = [];
    const dir = "file://" + pathname + (pathname.endsWith("/") ? "" : "/");
    await openIDBCursor(metaStore, IDBKeyRange.lowerBound(dir, true), (cursor) => {
      const stat2 = cursor.value;
      if (stat2.url.startsWith(dir)) {
        const name2 = stat2.url.slice(dir.length);
        if (name2 !== "" && name2.indexOf("/") === -1) {
          entries.push([name2, stat2.type]);
        }
        return true;
      }
      return false;
    });
    return entries;
  }
  async readFile(name) {
    const url = filenameToURL(name).href;
    const blobStore = await this._getIdbObjectStore("fs-blob");
    const file = await promisifyIDBRequest(blobStore.get(url));
    if (!file) {
      throw new NotFoundError(url);
    }
    return file.content;
  }
  async readTextFile(filename) {
    return this.readFile(filename).then(decode);
  }
  async writeFile(name, content, context) {
    const { pathname, href: url } = filenameToURL(name);
    const dir = pathname.slice(0, pathname.lastIndexOf("/"));
    if (dir) {
      try {
        if ((await this.stat(dir)).type !== 2) {
          throw new Error(`write ${pathname}: not a directory`);
        }
      } catch (error) {
        if (error instanceof NotFoundError) {
          throw new Error(`write ${pathname}: no such file or directory`);
        }
        throw error;
      }
    }
    let oldStat = null;
    try {
      oldStat = await this.stat(url);
    } catch (error) {
      if (!(error instanceof NotFoundError)) {
        throw error;
      }
    }
    if (oldStat?.type === 2) {
      throw new Error(`write ${pathname}: is a directory`);
    }
    content = typeof content === "string" ? encode(content) : content;
    const now = Date.now();
    const newStat = {
      type: 1,
      version: (oldStat?.version ?? 0) + 1,
      ctime: oldStat?.ctime ?? now,
      mtime: now,
      size: content.byteLength
    };
    const [metaStore, blobStore] = await this._getIdbObjectStores(true);
    await Promise.all([
      promisifyIDBRequest(metaStore.put({ url, ...newStat })),
      promisifyIDBRequest(blobStore.put({ url, content }))
    ]);
    this._notify(oldStat ? "modify" : "create", pathname, 1, context);
  }
  async delete(name, options) {
    const { pathname, href: url } = filenameToURL(name);
    const stat = await this.stat(url);
    if (stat.type === 1) {
      const [metaStore, blobStore] = await this._getIdbObjectStores(true);
      await Promise.all([
        promisifyIDBRequest(metaStore.delete(url)),
        promisifyIDBRequest(blobStore.delete(url))
      ]);
      this._notify("remove", pathname, 1);
    } else if (stat.type === 2) {
      if (options?.recursive) {
        const promises = [];
        const [metaStore, blobStore] = await this._getIdbObjectStores(true);
        const deleted = [];
        promises.push(openIDBCursor(metaStore, IDBKeyRange.lowerBound(url), (cursor) => {
          const stat2 = cursor.value;
          if (stat2.url.startsWith(url)) {
            if (stat2.type === 1) {
              promises.push(promisifyIDBRequest(blobStore.delete(stat2.url)));
            }
            promises.push(promisifyIDBRequest(cursor.delete()));
            deleted.push([stat2.url, stat2.type]);
            return true;
          }
          return false;
        }));
        await Promise.all(promises);
        for (const [url2, type] of deleted) {
          this._notify("remove", new URL(url2).pathname, type);
        }
      } else {
        const entries = await this.readDirectory(url);
        if (entries.length > 0) {
          throw new Error(`delete ${url}: directory not empty`);
        }
        const metaStore = await this._getIdbObjectStore("fs-meta", true);
        await promisifyIDBRequest(metaStore.delete(url));
        this._notify("remove", pathname, 2);
      }
    } else {
      const metaStore = await this._getIdbObjectStore("fs-meta", true);
      await promisifyIDBRequest(metaStore.delete(url));
      this._notify("remove", pathname, stat.type);
    }
  }
  async copy(source, target, options) {
    throw new Error("Method not implemented.");
  }
  async rename(oldName, newName, options) {
    const { href: oldUrl, pathname: oldPath } = filenameToURL(oldName);
    const { href: newUrl, pathname: newPath } = filenameToURL(newName);
    const oldStat = await this.stat(oldUrl);
    try {
      const stat = await this.stat(newUrl);
      if (!options?.overwrite) {
        throw new Error(`rename ${oldUrl} to ${newUrl}: file exists`);
      }
      await this.delete(newUrl, stat.type === 2 ? { recursive: true } : void 0);
    } catch (error) {
      if (!(error instanceof NotFoundError)) {
        throw error;
      }
    }
    const newPathDirname = newPath.slice(0, newPath.lastIndexOf("/"));
    if (newPathDirname) {
      try {
        if ((await this.stat(newPathDirname)).type !== 2) {
          throw new Error(`rename ${oldUrl} to ${newUrl}: Not a directory`);
        }
      } catch (error) {
        if (error instanceof NotFoundError) {
          throw new Error(`rename ${oldUrl} to ${newUrl}: No such file or directory`);
        }
        throw error;
      }
    }
    const [metaStore, blobStore] = await this._getIdbObjectStores(true);
    const promises = [
      promisifyIDBRequest(metaStore.delete(oldUrl)),
      promisifyIDBRequest(metaStore.put({ ...oldStat, url: newUrl }))
    ];
    const renameBlob = (oldUrl2, newUrl2) => openIDBCursor(blobStore, IDBKeyRange.only(oldUrl2), (cursor) => {
      promises.push(promisifyIDBRequest(blobStore.put({ url: newUrl2, content: cursor.value.content })));
      promises.push(promisifyIDBRequest(cursor.delete()));
    });
    const moved = [[oldPath, newPath, oldStat.type]];
    if (oldStat.type === 1) {
      promises.push(renameBlob(oldUrl, newUrl));
    } else if (oldStat.type === 2) {
      let dirUrl = oldUrl;
      if (!dirUrl.endsWith("/")) {
        dirUrl += "/";
      }
      const renamingChildren = openIDBCursor(
        metaStore,
        IDBKeyRange.lowerBound(dirUrl, true),
        (cursor) => {
          const stat = cursor.value;
          if (stat.url.startsWith(dirUrl)) {
            const url = newUrl + stat.url.slice(dirUrl.length - 1);
            if (stat.type === 1) {
              promises.push(renameBlob(stat.url, url));
            }
            promises.push(promisifyIDBRequest(metaStore.put({ ...stat, url })));
            promises.push(promisifyIDBRequest(cursor.delete()));
            moved.push([new URL(stat.url).pathname, new URL(url).pathname, stat.type]);
            return true;
          }
          return false;
        }
      );
      promises.push(renamingChildren);
    }
    await Promise.all(promises);
    for (const [oldPath2, newPath2, type] of moved) {
      this._notify("remove", oldPath2, type);
      this._notify("create", newPath2, type);
    }
  }
  watch(filename, handleOrOptions, handle) {
    const options = typeof handleOrOptions === "function" ? void 0 : handleOrOptions;
    handle = typeof handleOrOptions === "function" ? handleOrOptions : handle;
    if (typeof handle !== "function") {
      throw new TypeError("handle must be a function");
    }
    const watcher = { pathname: filenameToURL(filename).pathname, recursive: options?.recursive ?? false, handle };
    this._watchers.add(watcher);
    return () => {
      this._watchers.delete(watcher);
    };
  }
  async _notify(kind, pathname, type, context) {
    for (const watcher of this._watchers) {
      if (watcher.pathname === pathname || watcher.recursive && (watcher.pathname === "/" || pathname.startsWith(watcher.pathname + "/"))) {
        watcher.handle(kind, pathname, type, context);
      }
    }
  }
};
var WorkspaceDatabase = class {
  _db;
  constructor(name, ...stores) {
    const open = () => openIDB(name, 1, ...stores).then((db) => {
      db.onclose = () => {
        this._db = open();
      };
      return this._db = db;
    });
    this._db = open();
  }
  async open() {
    return await this._db;
  }
};
var WorkspaceStateStorage = class {
  #db;
  constructor(dbName) {
    this.#db = new WorkspaceDatabase(
      dbName,
      {
        name: "store",
        keyPath: "url"
      }
    );
  }
  async get(uri) {
    const url = normalizeURL(uri).href;
    const store = (await this.#db.open()).transaction("store", "readonly").objectStore("store");
    return promisifyIDBRequest(store.get(url)).then((result) => result?.state);
  }
  async save(uri, state) {
    const url = normalizeURL(uri).href;
    const store = (await this.#db.open()).transaction("store", "readwrite").objectStore("store");
    await promisifyIDBRequest(store.put({ url, state }));
  }
};
var LocalStorageHistory = class {
  _state;
  _maxHistory;
  _handlers = /* @__PURE__ */ new Set();
  constructor(scope, maxHistory = 100) {
    const defaultState = { "current": -1, "history": [] };
    this._state = supportLocalStorage() ? createPersistStateStorage("modern-monaco-workspace-history:" + scope, defaultState) : defaultState;
    this._maxHistory = maxHistory;
  }
  _onPopState() {
    for (const handler of this._handlers) {
      handler(this.state);
    }
  }
  get state() {
    return { current: this._state.history[this._state.current] ?? "" };
  }
  back() {
    this._state.current--;
    if (this._state.current < 0) {
      this._state.current = 0;
    }
    this._onPopState();
  }
  forward() {
    this._state.current++;
    if (this._state.current >= this._state.history.length) {
      this._state.current = this._state.history.length - 1;
    }
    this._onPopState();
  }
  push(name) {
    const url = filenameToURL(name);
    const history2 = this._state.history.slice(0, this._state.current + 1);
    history2.push(url.href);
    if (history2.length > this._maxHistory) {
      history2.shift();
    }
    this._state.history = history2;
    this._state.current = history2.length - 1;
    this._onPopState();
  }
  replace(name) {
    const url = filenameToURL(name);
    const history2 = [...this._state.history];
    if (this._state.current === -1) {
      this._state.current = 0;
    }
    history2[this._state.current] = url.href;
    this._state.history = history2;
    this._onPopState();
  }
  onChange(handler) {
    this._handlers.add(handler);
    return () => {
      this._handlers.delete(handler);
    };
  }
};
var BrowserHistory = class {
  _basePath = "";
  _current = "";
  _handlers = /* @__PURE__ */ new Set();
  constructor(basePath = "") {
    this._basePath = "/" + basePath.split("/").filter(Boolean).join("/");
    this._current = this._trimBasePath(location.pathname);
    window.addEventListener("popstate", () => {
      this._current = this._trimBasePath(location.pathname);
      this._onPopState();
    });
  }
  _trimBasePath(pathname) {
    if (pathname != "/" && pathname.startsWith(this._basePath)) {
      return new URL(pathname.slice(this._basePath.length), "file:///").href;
    }
    return "";
  }
  _joinBasePath(url) {
    const basePath = this._basePath === "/" ? "" : this._basePath;
    if (url.protocol === "file:") {
      return basePath + url.pathname;
    }
    return basePath + "/" + url.href;
  }
  _onPopState() {
    for (const handler of this._handlers) {
      handler(this.state);
    }
  }
  get state() {
    return { current: this._current };
  }
  back() {
    history.back();
  }
  forward() {
    history.forward();
  }
  push(name) {
    const url = filenameToURL(name);
    history.pushState(null, "", this._joinBasePath(url));
    this._current = url.href;
    this._onPopState();
  }
  replace(name) {
    const url = filenameToURL(name);
    history.replaceState(null, "", this._joinBasePath(url));
    this._current = url.href;
    this._onPopState();
  }
  onChange(handler) {
    this._handlers.add(handler);
    return () => {
      this._handlers.delete(handler);
    };
  }
};
export {
  NotFoundError,
  Workspace
};
