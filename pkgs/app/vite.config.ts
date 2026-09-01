// Vite config's build shims (React CJS/ESM interop, Node polyfill CJS
// interop, the onchain-runtime-v3 WASM shim, and the proof-server proxy) are
// adapted from midnightntwrk/example-counter (via midnight-rps-sample-app),
// Copyright (C) 2025 Midnight Foundation, licensed Apache License 2.0. This
// is hard-won production-debugging work (several of these bugs only surface
// in a real production build in a real browser, not `tsc`/`vite build`
// itself) -- reused rather than re-discovered. Trimmed for Umbra: no i18n,
// no Tailwind/shadcn UI kit.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import inject from "@rollup/plugin-inject";
import react from "@vitejs/plugin-react";
import fs from "fs";
import { createRequire } from "module";
import stdLibBrowser from "node-stdlib-browser";
import path from "path";
import { defineConfig, type Plugin } from "vite";
import wasm from "vite-plugin-wasm";

const _require = createRequire(import.meta.url);

// Resolve onchain-runtime-v3 browser entry explicitly (avoid Node's `node` condition).
// compact-runtime@0.15.0 is pure ESM and re-exports from onchain-runtime-v3.
const _crPkgPath = _require.resolve(
  "@midnight-ntwrk/compact-runtime/package.json",
);
const _crNodeModules = path.dirname(path.dirname(path.dirname(_crPkgPath)));
const onchainRuntimeBrowserPath = path.join(
  _crNodeModules,
  "@midnight-ntwrk",
  "onchain-runtime-v3",
  "midnight_onchain_runtime_wasm.js",
);

// `util`/`assert` aren't direct dependencies of this package (only
// node-stdlib-browser's), so read the paths node-stdlib-browser itself
// already resolved for its polyfills.
const utilPkgDir = stdLibBrowser.util as unknown as string;
const assertPkgDir = stdLibBrowser.assert as unknown as string;
const midnightJsUtilsCjsEntry = _require.resolve(
  "@midnight-ntwrk/midnight-js-utils",
);
const cryptoPkgDir = stdLibBrowser.crypto as unknown as string;
const nodeBuiltinAliasesForEsbuild = Object.fromEntries(
  Object.entries(stdLibBrowser).filter(([find]) => !find.startsWith("node:")),
) as Record<string, string>;
const pathPkgDir = stdLibBrowser.path as unknown as string;
const semverEntry = _require.resolve("semver");

/**
 * Virtual ESM shim for @midnight-ntwrk/onchain-runtime-v3.
 * onchain-runtime-v3 uses top-level await for WASM initialization which
 * esbuild cannot handle. This plugin redirects the import to the explicit
 * browser WASM entry point, bypassing the Node.js conditional export.
 */
function onchainRuntimeV3ShimPlugin(onchainRuntimePath: string): Plugin {
  const ONCHAIN_RUNTIME_V3_ID = "@midnight-ntwrk/onchain-runtime-v3";
  return {
    name: "onchain-runtime-v3-shim",
    enforce: "pre",
    resolveId(id) {
      if (id === ONCHAIN_RUNTIME_V3_ID) return onchainRuntimePath;
    },
  };
}

/**
 * Production-only React ESM shim. In dev mode, Vite pre-bundles React via
 * esbuild with needsInterop:true, which generates named-export proxy
 * modules automatically. In production (Rollup), React's index.js has a
 * conditional require() that Rollup's commonjs plugin cannot statically
 * analyse for named exports -- this shim inlines the CJS production files
 * as IIFEs with explicit named ESM exports instead.
 */
function reactBuildShimPlugin(): Plugin {
  const rDir = path.dirname(_require.resolve("react/package.json"));
  const rdDir = path.dirname(_require.resolve("react-dom/package.json"));
  const rdRequire = createRequire(path.join(rdDir, "package.json"));
  const schedDir = path.dirname(rdRequire.resolve("scheduler/package.json"));

  const REACT_ID = "\0virtual:react-build";
  const REACT_DOM_ID = "\0virtual:react-dom-build";
  const REACT_DOM_CLIENT_ID = "\0virtual:react-dom-client-build";
  const JSX_RUNTIME_ID = "\0virtual:jsx-runtime-build";
  const JSX_DEV_RUNTIME_ID = "\0virtual:jsx-dev-runtime-build";

  return {
    name: "react-build-shim",
    apply: "build",
    enforce: "pre",
    resolveId(id) {
      if (id === "react") return REACT_ID;
      if (id === "react-dom") return REACT_DOM_ID;
      if (id === "react-dom/client") return REACT_DOM_CLIENT_ID;
      if (id === "react/jsx-runtime") return JSX_RUNTIME_ID;
      if (id === "react/jsx-dev-runtime") return JSX_DEV_RUNTIME_ID;
    },
    load(id) {
      if (id === REACT_ID) {
        const cjsCode = fs.readFileSync(path.join(rDir, "cjs/react.production.js"), "utf-8");
        return `
var _r = {};
(function(exports) {
${cjsCode}
})(_r);
export const {
  Activity, Children, Component, Fragment, Profiler, PureComponent,
  StrictMode, Suspense,
  __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE,
  __COMPILER_RUNTIME,
  cache, cacheSignal, cloneElement, createContext, createElement, createRef,
  forwardRef, isValidElement, lazy, memo, startTransition,
  unstable_useCacheRefresh, use, useActionState, useCallback, useContext,
  useDebugValue, useDeferredValue, useEffect, useEffectEvent, useId,
  useImperativeHandle, useInsertionEffect, useLayoutEffect, useMemo,
  useOptimistic, useReducer, useRef, useState, useSyncExternalStore,
  useTransition, version,
} = _r;
export default _r;
`;
      }
      if (id === REACT_DOM_ID) {
        const cjsCode = fs.readFileSync(path.join(rdDir, "cjs/react-dom.production.js"), "utf-8");
        return `
import _react from "react";
var _rd = {};
(function(exports, require) {
${cjsCode}
})(_rd, function(id) {
  if (id === "react") return _react;
  throw new Error("[react-dom-build-shim] Unknown module: " + id);
});
export const {
  __DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE,
  createPortal, flushSync, preconnect, prefetchDNS, preinit, preinitModule,
  preload, preloadModule, requestFormReset, unstable_batchedUpdates,
  useFormState, useFormStatus, version,
} = _rd;
export default _rd;
`;
      }
      if (id === REACT_DOM_CLIENT_ID) {
        const schedCode = fs.readFileSync(path.join(schedDir, "cjs/scheduler.production.js"), "utf-8");
        const cjsCode = fs.readFileSync(path.join(rdDir, "cjs/react-dom-client.production.js"), "utf-8");
        return `
import _react from "react";
import _rd from "react-dom";
var _sched = {};
(function(exports) {
${schedCode}
})(_sched);
var _rdc = {};
(function(exports, require) {
${cjsCode}
})(_rdc, function(id) {
  if (id === "react") return _react;
  if (id === "react-dom") return _rd;
  if (id === "scheduler") return _sched;
  throw new Error("[react-dom-client-build-shim] Unknown module: " + id);
});
export const { createRoot, hydrateRoot } = _rdc;
export default _rdc;
`;
      }
      if (id === JSX_RUNTIME_ID) {
        const cjsCode = fs.readFileSync(path.join(rDir, "cjs/react-jsx-runtime.production.js"), "utf-8");
        return `
import _react from "react";
var _jsx = {};
(function(exports, require) {
${cjsCode}
})(_jsx, function(id) {
  if (id === "react") return _react;
  throw new Error("[react-jsx-runtime-build-shim] Unknown module: " + id);
});
export const { Fragment, jsx, jsxs } = _jsx;
export default _jsx;
`;
      }
      if (id === JSX_DEV_RUNTIME_ID) {
        const cjsCode = fs.readFileSync(path.join(rDir, "cjs/react-jsx-dev-runtime.production.js"), "utf-8");
        return `
import _react from "react";
var _jsxd = {};
(function(exports, require) {
${cjsCode}
})(_jsxd, function(id) {
  if (id === "react") return _react;
  throw new Error("[react-jsx-dev-runtime-build-shim] Unknown module: " + id);
});
export const { Fragment, jsxDEV } = _jsxd;
export default _jsxd;
`;
      }
    },
  };
}

interface CjsInteropEntry {
  specifiers: string[];
  pkgDir: string;
  entryFile: string;
  external?: string[];
  namedExports?: string[];
  alias?: Record<string, string>;
}

/**
 * Production-only shim for CJS packages that @rollup/plugin-commonjs only
 * partially transforms: an internal helper submodule gets wrapped in an
 * IIFE correctly, but the entry file's top-level `exports.foo = ...` is
 * left as a bare, unbound reference -- "Uncaught ReferenceError: exports is
 * not defined" in the browser. Bundling each one with esbuild directly
 * sidesteps the bug (esbuild's CJS->ESM interop handles these shapes
 * correctly where Rollup's does not).
 */
function cjsInteropBuildShimPlugin(entries: CjsInteropEntry[]): Plugin {
  const resolved = entries.map((e, i) => ({
    ...e,
    virtualId: `\0virtual:cjs-interop-build-${i}`,
    entryPath: path.join(e.pkgDir, e.entryFile),
  }));
  const cache = new Map<string, string>();

  return {
    name: "cjs-interop-build-shim",
    apply: "build",
    enforce: "pre",
    resolveId(id) {
      for (const e of resolved) {
        if (
          e.specifiers.includes(id) ||
          id === e.pkgDir ||
          id === `${e.pkgDir}/` ||
          id === e.entryPath
        ) {
          return e.virtualId;
        }
      }
    },
    async load(id) {
      const e = resolved.find((r) => r.virtualId === id);
      if (!e) return;
      const cached = cache.get(e.virtualId);
      if (cached) return cached;
      const viteRequire = createRequire(_require.resolve("vite/package.json"));
      const esbuild = await import(viteRequire.resolve("esbuild"));
      const result = await esbuild.build({
        entryPoints: [e.entryPath],
        bundle: true,
        format: "esm",
        platform: "browser",
        write: false,
        target: "es2020",
        external: e.external,
        alias: e.alias,
      });
      let code = result.outputFiles[0].text;
      if (e.namedExports) {
        const matches = [...code.matchAll(/export default ([^;]+);/g)];
        const lastMatch = matches.at(-1);
        if (!lastMatch) {
          throw new Error(
            `[cjs-interop-build-shim] expected an "export default <expr>;" to rewrite for ${e.entryPath}`,
          );
        }
        const before = code.slice(0, lastMatch.index);
        const after = code.slice(lastMatch.index + lastMatch[0].length);
        code = `${before}const __shimExports = ${lastMatch[1]};
export default __shimExports;
export const { ${e.namedExports.join(", ")} } = __shimExports;
${after}`;
      }
      cache.set(e.virtualId, code);
      return code;
    },
  };
}

export default defineConfig({
  plugins: [
    reactBuildShimPlugin(),
    cjsInteropBuildShimPlugin([
      { specifiers: ["util", "node:util"], pkgDir: utilPkgDir, entryFile: "util.js" },
      { specifiers: ["assert", "node:assert"], pkgDir: assertPkgDir, entryFile: "build/assert.js" },
      {
        specifiers: ["@midnight-ntwrk/midnight-js-utils"],
        pkgDir: path.dirname(midnightJsUtilsCjsEntry),
        entryFile: path.basename(midnightJsUtilsCjsEntry),
        external: ["@midnight-ntwrk/wallet-sdk-address-format"],
        namedExports: [
          "assertDefined", "assertIsContractAddress", "assertIsHex", "assertUndefined",
          "fromHex", "isHex", "parseCoinPublicKeyToHex", "parseEncPublicKeyToHex",
          "parseHex", "toHex", "ttlOneHour",
        ],
      },
      {
        specifiers: ["crypto", "node:crypto"],
        pkgDir: cryptoPkgDir,
        entryFile: "index.js",
        // Genuinely used at runtime: encrypts the private-state (secret key
        // / work hash / salt) LevelDB store -- see
        // @midnight-ntwrk/midnight-js-level-private-state-provider.
        alias: nodeBuiltinAliasesForEsbuild,
        namedExports: [
          "randomBytes", "rng", "pseudoRandomBytes", "prng", "createHash", "Hash",
          "createHmac", "Hmac", "getHashes", "pbkdf2", "pbkdf2Sync", "Cipher",
          "createCipher", "Cipheriv", "createCipheriv", "Decipher", "createDecipher",
          "Decipheriv", "createDecipheriv", "getCiphers", "listCiphers",
          "DiffieHellmanGroup", "createDiffieHellmanGroup", "getDiffieHellman",
          "createDiffieHellman", "DiffieHellman", "createSign", "Sign", "createVerify",
          "Verify", "createECDH", "publicEncrypt", "privateEncrypt", "publicDecrypt",
          "privateDecrypt", "randomFill", "randomFillSync", "createCredentials",
          "constants", "timingSafeEqual",
        ],
      },
      { specifiers: ["path", "node:path"], pkgDir: pathPkgDir, entryFile: "index.js" },
      { specifiers: ["semver"], pkgDir: path.dirname(semverEntry), entryFile: path.basename(semverEntry) },
    ]),
    onchainRuntimeV3ShimPlugin(onchainRuntimeBrowserPath),
    react(),
    wasm(),
    inject({ process: "process/browser", Buffer: ["buffer", "Buffer"] }),
  ],
  server: {
    // Proxy proof-server requests through the dev server so the browser never
    // fetches http://127.0.0.1:6300 directly. Lace's service worker intercepts
    // all fetch calls from the page; requests to 127.0.0.1 from a service
    // worker context are blocked by Chrome (ERR_FAILED). A same-origin path
    // lets the service worker pass the request through to Vite's Node
    // process, which proxies it server-side -- bypassing that restriction.
    proxy: {
      "/proof-server": {
        target: "http://127.0.0.1:6300",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/proof-server/, ""),
      },
    },
  },
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: [
      { find: "@", replacement: path.resolve(__dirname, "./src") },
      { find: "@midnight-ntwrk/compact-runtime", replacement: path.dirname(_crPkgPath) },
      ...Object.entries(stdLibBrowser).map(([find, replacement]) => ({
        find,
        replacement: replacement as string,
      })),
    ],
  },
  optimizeDeps: {
    exclude: ["@midnight-ntwrk/onchain-runtime", "@midnight-ntwrk/onchain-runtime-v3"],
    include: [
      "@umbra/contract",
      "react",
      "react-dom",
      "react-dom/client",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
    ],
  },
  define: {
    global: "globalThis",
  },
  build: {
    target: "esnext",
    commonjsOptions: {
      transformMixedEsModules: true,
      include: [/node_modules/],
      strictRequires: true,
    },
  },
  worker: {
    format: "es",
    plugins: () => [wasm()],
  },
});
