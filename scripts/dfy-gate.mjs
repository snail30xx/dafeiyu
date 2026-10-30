/**
 * dfy-gate：大肥鱼面板固定入口网关。
 * 宿主每次重启都会更换 token，旧链接/裸地址打开是 401 文本页。
 * 本网关监听 3081，任何请求都从宿主日志提取最新 token 并 302 到带 token 的面板地址，
 * 用户收藏 http://127.0.0.1:3081/ 即可永久直达。
 * 前置约定：宿主用 `node --import tsx/esm apps/cli/src/bin.ts --profile dafeiyu --no-open > %TEMP%/dfy-host.log 2>&1` 启动。
 * byClaude
 */
// byClaude-start
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const logPath = join(process.env.TEMP ?? '/tmp', 'dfy-host.log')

function currentToken() {
  try {
    const text = readFileSync(logPath, 'utf8')
    const matches = [...text.matchAll(/http:\/\/127\.0\.0\.1:3080\/\?token=([A-Za-z0-9_-]+)/g)]
    return matches.length > 0 ? matches.at(-1)[1] : null
  } catch {
    return null
  }
}

createServer((req, res) => {
  const token = currentToken()
  if (token === null) {
    res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' })
    res.end(`宿主日志里还没有 token（${logPath}）。先启动 dafeiyu 宿主，再刷新本页。`)
    return
  }
  res.writeHead(302, { location: `http://127.0.0.1:3080/?token=${token}` })
  res.end()
}).listen(3081, '127.0.0.1', () => {
  console.log(`dfy-gate: http://127.0.0.1:3081/ -> 自动带最新 token（读 ${logPath}）`)
})
// byClaude-end
