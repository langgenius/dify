// src/cache.ts
import { defineProperty, normalizeURL, openIDB, promisifyIDBRequest } from "./util.mjs";
var IndexedDB = class {
  #db;
  constructor(name) {
    this.#db = this.#openDB(name);
  }
  #openDB(name) {
    return openIDB(name, 1, { name: "store", keyPath: "url" }).then((db) => {
      db.onclose = () => {
        this.#db = this.#openDB(name);
      };
      return this.#db = db;
    });
  }
  async get(url) {
    const db = await this.#db;
    const tx = db.transaction("store", "readonly").objectStore("store");
    return promisifyIDBRequest(tx.get(url));
  }
  async put(file) {
    const db = await this.#db;
    const tx = db.transaction("store", "readwrite").objectStore("store");
    await promisifyIDBRequest(tx.put(file));
  }
  async delete(url) {
    const db = await this.#db;
    const tx = db.transaction("store", "readwrite").objectStore("store");
    await promisifyIDBRequest(tx.delete(url));
  }
};
var MemoryCache = class {
  #cache = /* @__PURE__ */ new Map();
  async get(url) {
    return this.#cache.get(url) ?? null;
  }
  async put(file) {
    this.#cache.set(file.url, file);
  }
  async delete(url) {
    this.#cache.delete(url);
  }
};
var Cache = class {
  _db;
  constructor(name) {
    if (globalThis.indexedDB) {
      this._db = new IndexedDB(name);
    } else {
      this._db = new MemoryCache();
    }
  }
  async fetch(url) {
    const storedRes = await this.query(url);
    if (storedRes) {
      return storedRes;
    }
    const res = await fetch(url);
    if (!res.ok || !res.headers.has("cache-control")) {
      return res;
    }
    const cacheControl = res.headers.get("cache-control");
    const maxAgeStr = cacheControl.match(/max-age=(\d+)/)?.[1];
    if (!maxAgeStr) {
      return res;
    }
    const maxAge = parseInt(maxAgeStr);
    if (isNaN(maxAge) || maxAge <= 0) {
      return res;
    }
    const createdAt = Date.now();
    const expiresAt = createdAt + maxAge * 1e3;
    const file = {
      url: res.url,
      content: null,
      createdAt,
      expiresAt,
      headers: []
    };
    if (res.redirected) {
      await this._db.put({
        ...file,
        url: url instanceof URL ? url.href : url,
        // raw url
        headers: [["location", res.url]]
      });
    }
    for (const header of ["content-type", "x-typescript-types"]) {
      if (res.headers.has(header)) {
        file.headers.push([header, res.headers.get(header)]);
      }
    }
    file.content = await res.arrayBuffer();
    await this._db.put(file);
    const resp = new Response(file.content, { headers: file.headers });
    defineProperty(resp, "url", res.url);
    defineProperty(resp, "redirected", res.redirected);
    return resp;
  }
  async query(key) {
    const url = normalizeURL(key).href;
    const file = await this._db.get(url);
    if (file) {
      if (file.expiresAt < Date.now()) {
        await this._db.delete(url);
        return null;
      }
      const headers = new Headers(file.headers);
      if (headers.has("location")) {
        const redirectedUrl = headers.get("location");
        const res2 = await this.query(redirectedUrl);
        if (res2) {
          defineProperty(res2, "redirected", true);
        }
        return res2;
      }
      const res = new Response(file.content, { headers });
      defineProperty(res, "url", url);
      return res;
    }
    return null;
  }
};
var cache = new Cache("modern-monaco-cache");
var cache_default = cache;
export {
  cache,
  cache_default as default
};
