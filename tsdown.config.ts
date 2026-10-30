/**
 * 大肥鱼构建配置：两段式。
 * 1. `tsc -p tsconfig.json` 把 src/ 编到 lib/types/（d.ts + sourcemap）；
 * 2. tsdown 从 lib/types 打两个产物：
 *    - lib/index.js：host 半侧（Node ESM），dsh 包保持外部导入，运行时由宿主解析；
 *    - lib/client.js：浏览器半侧，包成 window.__ModuleLoader__.load({ id, factory })
 *      的 closure-factory CJS 产物；模块表基线（react/cordis/ui-primitives/ui-slots 等）
 *      保持外部 require，其余依赖内联。
 */
import { defineConfig } from 'tsdown'
import { fileURLToPath } from 'node:url'

const id = 'dafeiyu'

/** 浏览器侧 Node 内置 shim 的绝对路径（vfile 的 minproc/minpath/minurl 引用 node: 内置，宿主模块表无此行）。 */
const SHIM = (name: string): string =>
  fileURLToPath(new URL(`./lib/types/client/${name}.js`, import.meta.url))

/** dsh Web shell 冻结模块表的基线外部依赖（packages/client/web/src/platform.ts）。 */
const PLATFORM_MODULES = new Set([
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
  'zod', '@tanstack/react-virtual',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
])

/** dsh.client.external 额外请求的模块表行（本插件当前为空，跨包协作走 cordis 服务与类型导入）。 */
const EXTRA_EXTERNALS = new Set<string>([])

const isExternal = (specifier: string): boolean =>
  PLATFORM_MODULES.has(specifier) || EXTRA_EXTERNALS.has(specifier)

export default defineConfig([
  {
    name: `${id}/host`,
    entry: { index: 'lib/types/index.js' },
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    deps: {
      neverBundle: (specifier: string) => specifier.startsWith('@deepseek-ai/'),
      alwaysBundle: (specifier: string) => !specifier.startsWith('@deepseek-ai/'),
    },
  },
  {
    name: `${id}/client`,
    entry: { client: 'lib/types/client/index.js' },
    outDir: 'lib',
    format: ['cjs'],
    platform: 'browser',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    sourcemap: true,
    // byClaude-start react-markdown 链（vfile 的 minproc/minpath/minurl）引用 node: 内置模块，
    // 宿主 renderer 模块表无内置行导致启动 import failed；全部 alias 成浏览器 shim 内联（byClaude）
    alias: {
      'node:process': SHIM('process-shim'),
      'node:path': SHIM('path-shim'),
      'node:url': SHIM('url-shim'),
    },
    // byClaude-end
    deps: {
      neverBundle: isExternal,
      alwaysBundle: (specifier: string) => !isExternal(specifier),
    },
    outputOptions: {
      entryFileNames: 'client.js',
      chunkFileNames: 'client.[name].js',
      sourcemapExcludeSources: true,
      banner: (chunk: { isEntry: boolean; fileName: string }) =>
        `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, ${chunk.isEntry ? '' : `chunk: ${JSON.stringify(chunk.fileName)}, `}factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
])
