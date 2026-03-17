// src/util.ts
var enc = /* @__PURE__ */ new TextEncoder();
var dec = /* @__PURE__ */ new TextDecoder();
function encode(data) {
  return typeof data === "string" ? enc.encode(data) : data;
}
function decode(data) {
  return data instanceof Uint8Array ? dec.decode(data) : data;
}
function defineProperty(obj, prop, value) {
  Object.defineProperty(obj, prop, { value });
}
function normalizeURL(uri) {
  return uri instanceof URL ? uri : new URL(uri, "file:///");
}
function filenameToURL(filename) {
  if (filename.startsWith("file://")) {
    filename = filename.slice(7);
  }
  const url = new URL(filename.replace(/[\/\\]+/g, "/"), "file:///");
  if (url.pathname.endsWith("/")) {
    url.pathname = url.pathname.slice(0, -1);
  }
  url.search = "";
  return url;
}
function isPlainObject(v) {
  return typeof v === "object" && v !== null && v.constructor === Object;
}
function isDigital(v) {
  return typeof v === "number" || typeof v === "string" && /^\d+$/.test(v);
}
function debunce(fn, delay) {
  let timer = null;
  return () => {
    if (timer !== null) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = null;
      fn();
    }, delay);
  };
}
function createPersistTask(persist, delay = 500) {
  let timer = null;
  const askToExit = (e) => {
    e.preventDefault();
    return false;
  };
  return () => {
    if (timer !== null) {
      return;
    }
    addEventListener("beforeunload", askToExit);
    timer = setTimeout(async () => {
      timer = null;
      await persist();
      removeEventListener("beforeunload", askToExit);
    }, delay);
  };
}
function createSyncPersistTask(persist, delay = 500) {
  let timer = null;
  return () => {
    if (timer !== null) {
      return;
    }
    addEventListener("beforeunload", persist);
    timer = setTimeout(() => {
      timer = null;
      removeEventListener("beforeunload", persist);
      persist();
    }, delay);
  };
}
function createPersistStateStorage(storeKey, defaultValue) {
  let state;
  const init = defaultValue ?? {};
  const storeValue = localStorage.getItem(storeKey);
  if (storeValue) {
    try {
      for (const [key, value] of Object.entries(JSON.parse(storeValue))) {
        init[key] = Object.freeze(value);
      }
    } catch (e) {
      console.error(e);
    }
  }
  const persist = createSyncPersistTask(() => localStorage.setItem(storeKey, JSON.stringify(state)), 1e3);
  return state = createProxy(init, persist);
}
function createProxy(obj, onChange) {
  let filled = false;
  const proxy = new Proxy(/* @__PURE__ */ Object.create(null), {
    get(target, key) {
      return Reflect.get(target, key);
    },
    set(target, key, value) {
      if (isPlainObject(value) && !Object.isFrozen(value)) {
        value = createProxy(value, onChange);
      }
      const ok = Reflect.set(target, key, value);
      if (ok && filled) {
        onChange();
      }
      return ok;
    }
  });
  for (const [key, value] of Object.entries(obj)) {
    proxy[key] = value;
  }
  filled = true;
  return proxy;
}
function supportLocalStorage() {
  if (globalThis.localStorage) {
    try {
      localStorage.setItem("..", "");
      localStorage.removeItem("..");
      return true;
    } catch {
    }
  }
  return false;
}
function promisifyIDBRequest(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function openIDB(name, version = 1, ...stores) {
  const openRequest = indexedDB.open(name, version);
  const promises = [];
  openRequest.onupgradeneeded = () => {
    const db2 = openRequest.result;
    for (const { name: name2, keyPath, onCreate } of stores) {
      if (!db2.objectStoreNames.contains(name2)) {
        const store = db2.createObjectStore(name2, { keyPath });
        if (onCreate) {
          promises.push(onCreate(store));
        }
      }
    }
  };
  const db = await promisifyIDBRequest(openRequest);
  await Promise.all(promises);
  return db;
}
function openIDBCursor(store, range, callback, direction) {
  return new Promise((resolve, reject) => {
    const corsor = store.openCursor(range, direction);
    corsor.onsuccess = () => {
      const cursor = corsor.result;
      if (cursor) {
        if (callback(cursor) !== false) {
          cursor.continue();
          return;
        }
      }
      resolve();
    };
    corsor.onerror = () => {
      reject(corsor.error);
    };
  });
}
function promiseWithResolvers() {
  if (Promise.withResolvers) {
    return Promise.withResolvers();
  }
  const p = /* @__PURE__ */ Object.create(null);
  p.promise = new Promise((resolve, reject) => {
    p.resolve = resolve;
    p.reject = reject;
  });
  return p;
}
export {
  createPersistStateStorage,
  createPersistTask,
  createProxy,
  createSyncPersistTask,
  debunce,
  decode,
  defineProperty,
  encode,
  filenameToURL,
  isDigital,
  isPlainObject,
  normalizeURL,
  openIDB,
  openIDBCursor,
  promiseWithResolvers,
  promisifyIDBRequest,
  supportLocalStorage
};
