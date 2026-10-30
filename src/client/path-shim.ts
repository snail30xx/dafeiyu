/**
 * 浏览器侧 node:path shim：vfile 的 lib/minpath.js 引用 node:path（宿主模块表无
 * Node 内置行）。vfile 只用它拼消息路径，POSIX 语义简化实现即可。
 * byClaude
 */
// byClaude-start
const normalizeSlashes = (value: string): string => value.replace(/\\/g, '/')
const joinParts = (parts: readonly string[]): string =>
  normalizeSlashes(parts.join('/')).replace(/\/+/g, '/')

const pathShim = {
  sep: '/',
  delimiter: ':',
  resolve: (...parts: string[]): string => {
    const joined = joinParts(parts)
    return joined.startsWith('/') ? joined : `/${joined}`
  },
  join: (...parts: string[]): string => joinParts(parts),
  normalize: (value: string): string => joinParts([value]),
  isAbsolute: (value: string): boolean => normalizeSlashes(value).startsWith('/'),
  basename: (value: string, ext?: string): string => {
    const base = joinParts([value]).split('/').filter(part => part !== '').at(-1) ?? ''
    return ext !== undefined && base.endsWith(ext) ? base.slice(0, base.length - ext.length) : base
  },
  dirname: (value: string): string => {
    const parts = joinParts([value]).split('/').filter(part => part !== '')
    parts.pop()
    return parts.length === 0 ? '/' : `/${parts.join('/')}`
  },
  extname: (value: string): string => {
    const base = joinParts([value]).split('/').at(-1) ?? ''
    const dot = base.lastIndexOf('.')
    return dot > 0 ? base.slice(dot) : ''
  },
  relative: (from: string, to: string): string => {
    const a = joinParts([from]).split('/').filter(part => part !== '')
    const b = joinParts([to]).split('/').filter(part => part !== '')
    let shared = 0
    while (shared < a.length && shared < b.length && a[shared] === b[shared]) shared += 1
    return '../'.repeat(Math.max(0, a.length - shared)) + b.slice(shared).join('/')
  },
}

export default pathShim
// byClaude-end
