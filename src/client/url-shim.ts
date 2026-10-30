/**
 * 浏览器侧 node:url shim：vfile 的 lib/minurl.js 具名 re-export
 * （`export {fileURLToPath as urlToPath} from 'node:url'`），所以这里必须
 * 具名导出（与 minpath/minproc 的 default 导入不同）。字符串近似转换即可。
 * byClaude
 */
// byClaude-start
export const fileURLToPath = (input: string | URL): string => {
  const value = typeof input === 'string' ? input : input.toString()
  return value.replace(/^file:\/\//, '').replace(/^\/([A-Za-z]:)/, '$1')
}

export const pathToFileURL = (input: string): URL =>
  new URL(`file:///${input.replace(/\\/g, '/').replace(/^\/+/, '')}`)
// byClaude-end
