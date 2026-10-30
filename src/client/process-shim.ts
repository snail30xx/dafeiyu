/**
 * 浏览器侧 node:process shim：vfile 的 lib/minproc.js 引用 node:process，宿主
 * renderer 模块表是冻结白名单、无 Node 内置行，出现即 "missed the module table"
 * 启动失败。tsdown 按 alias 整体替换。vfile 构造默认 cwd，对纯字符串渲染无语义。
 * byClaude
 */
// byClaude-start
const processShim = {
  env: { NODE_ENV: 'production' } as Record<string, string>,
  cwd: (): string => '/',
  platform: 'browser',
  argv: [] as string[],
  version: '',
  nextTick: (fn: () => void): void => { fn() },
}

export default processShim
// byClaude-end
