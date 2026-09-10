// dsh-setting-manager · Host 端
// v0.1：右键设置页「设置菜单」（settings.section 分区导航）→ 勾选菜单 →
// 控制分区显隐（纯视觉 display:none，不影响任何功能）；交互在 Client 端
// lib/client.js。
// 本文件职责：在 webServer 服务下注册 loopback-only web route
// GET/POST /api/setting-manager，并把隐藏分区 id 列表持久化到
// $DSH_HOME/dsh-setting-manager.json（跨浏览器持久化）。
// 持久化文件格式 version:1——{ "version": 1, "hidden": [...] }；写盘走原子写
// （先写 FILE.tmp 再 rename 覆盖 FILE，同文件系统 rename 原子，避免写一半损坏）。
// 安全校验（loopback 对端 + Host/Origin 同源），防御细节保留。
import { join } from 'node:path'
import { promises as fs } from 'node:fs'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'

/** 隐藏分区持久化文件：$DSH_HOME/dsh-setting-manager.json（纯路径计算，无 IO）。 */
const FILE = join(resolveDshHome(), 'dsh-setting-manager.json')

/** 读持久化状态，统一返回 { version: 1, hidden: string[] }（version:1 形状）。
 * 文件不存在 / 解析失败 / 顶层非对象 → 回退空状态 { version: 1, hidden: [] }；
 * 无 version 字段（旧格式）与 version !== 1（未来扩展）→ 按 version:1 保守处理：
 * 取 hidden（Array.isArray 校验，非数组 → []）并补 version: 1。 */
async function readState() {
  let parsed
  try {
    parsed = JSON.parse(await fs.readFile(FILE, 'utf8'))
  } catch {
    return { version: 1, hidden: [] }
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { version: 1, hidden: [] }
  }
  const hidden = Array.isArray(parsed.hidden) ? parsed.hidden : []
  return { version: 1, hidden }
}

/** 原子写持久化状态：先写 FILE.tmp 再 rename 覆盖 FILE（同文件系统 rename 原子，
 * 避免写一半损坏）。入参形状恒为 { version: 1, hidden: [...] }。 */
async function writeState(o) {
  const tmp = FILE + '.tmp'
  await fs.writeFile(tmp, JSON.stringify(o, null, 2), 'utf8')
  await fs.rename(tmp, FILE)
}

// ── 安全校验：loopback 对端 + Host/Origin 同源 ──

function isIpv4LoopbackAddress(address) {
  const parts = address.split('.')
  return parts.length === 4
    && parts[0] === '127'
    && parts.every(part => /^\d{1,3}$/u.test(part) && Number(part) <= 255)
}

/** Trust the transport peer, including Node's IPv4-mapped IPv6 forms. */
function isLoopbackRemoteAddress(address) {
  if (address === undefined) return false
  const normalized = address.toLowerCase().split('%', 1)[0]
  if (normalized === '::1' || isIpv4LoopbackAddress(normalized)) return true
  if (!normalized.startsWith('::ffff:')) return false
  const mapped = normalized.slice('::ffff:'.length)
  if (isIpv4LoopbackAddress(mapped)) return true
  const hexadecimal = /^([a-f0-9]{1,4}):([a-f0-9]{1,4})$/u.exec(mapped)
  return hexadecimal !== null && (Number.parseInt(hexadecimal[1], 16) >>> 8) === 127
}

function isLoopbackHostname(hostname) {
  if (hostname === 'localhost' || hostname === '[::1]' || hostname === '::1') return true
  return isIpv4LoopbackAddress(hostname)
}

function requestAuthority(req) {
  const host = req.headers.host
  if (typeof host !== 'string') return undefined
  try {
    const parsed = new URL('http://' + host)
    if (parsed.pathname !== '/' || parsed.search !== '' || parsed.hash !== '' || parsed.username !== '' || parsed.password !== '') {
      return undefined
    }
    return parsed
  } catch {
    return undefined
  }
}

/** Reject remote peers and DNS-rebinding Host headers before serving data. */
function isLoopbackRequest(req) {
  if (!isLoopbackRemoteAddress(req.socket?.remoteAddress)) return false
  const authority = requestAuthority(req)
  return authority !== undefined && isLoopbackHostname(authority.hostname)
}

/** Apply Fetch-Metadata/Origin checks; mutations require an Origin. */
function isTrustedBrowserRequest(req, requireOrigin) {
  if (req.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = req.headers.origin
  if (origin === undefined) return !requireOrigin
  if (typeof origin !== 'string') return false
  const authority = requestAuthority(req)
  if (authority === undefined) return false
  try {
    const parsed = new URL(origin)
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:')
      && parsed.host === authority.host
  } catch {
    return false
  }
}

function sendJson(res, status, value, headers = {}) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'cross-origin-resource-policy': 'same-origin',
    'referrer-policy': 'no-referrer',
    ...headers,
  })
  res.end(body)
}

class StatusRouteError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

async function readBody(req, maxBytes = 16 * 1024) {
  const contentLength = req.headers['content-length']
  if (typeof contentLength === 'string') {
    const declared = Number(contentLength)
    if (!Number.isSafeInteger(declared) || declared < 0) throw new StatusRouteError(400, 'invalid content-length')
    if (declared > maxBytes) throw new StatusRouteError(413, 'request body too large')
  }
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buffer.length
    if (total > maxBytes) throw new StatusRouteError(413, 'request body too large')
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/** /api/setting-manager handler：全权拥有响应（loopback-only；GET 读状态 / POST 写状态）。 */
async function handler(req, res) {
  if (!isLoopbackRequest(req)) {
    sendJson(res, 403, { ok: false, error: 'the setting-manager route is loopback-only' })
    return
  }
  if (!isTrustedBrowserRequest(req, req.method === 'POST')) {
    sendJson(res, 403, { ok: false, error: 'the setting-manager route requires a same-origin browser request' })
    return
  }
  if (req.method === 'GET') {
    const o = await readState()
    sendJson(res, 200, o)
    return
  }
  if (req.method === 'POST') {
    let raw
    try {
      raw = await readBody(req)
    } catch (err) {
      const status = err && typeof err.status === 'number' ? err.status : 400
      sendJson(res, status, { ok: false, error: err instanceof Error ? err.message : 'invalid request' })
      return
    }
    let value
    try {
      value = raw === '' ? {} : JSON.parse(raw)
    } catch {
      sendJson(res, 400, { ok: false, error: 'request body is not valid JSON' })
      return
    }
    if (value === null || typeof value !== 'object' || Array.isArray(value)) value = {}
    const hidden = Array.isArray(value.hidden) ? value.hidden.filter(x => typeof x === 'string') : []
    const state = { version: 1, hidden }
    try {
      await writeState(state)
    } catch {
      sendJson(res, 400, { ok: false, error: 'failed to persist setting state' })
      return
    }
    sendJson(res, 200, state)
    return
  }
  sendJson(res, 405, { ok: false }, { allow: 'GET, POST' })
}

/**
 * Host 端插件入口：webServer 服务下注册设置状态 route（disposer 挂在 fiber 上）。
 * webServer 缺席（如 headless profile）时 inject 回调不执行，不注册 route。
 * @param ctx - 插件上下文。
 * @returns 无（void）；不返回 fiber。
 */
export function apply(ctx) {
  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(() => {
      const unregister = webCtx.webServer.register({
        kind: 'exact',
        path: '/api/setting-manager',
        handler,
      })
      return () => { unregister() }
    }, 'dsh-setting-manager: /api/setting-manager')
  })
}
