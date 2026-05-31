#!/usr/bin/env node
/**
 * 超时真实根因诊断脚本
 *
 * 用途：在真实 DevTools 运行时，测量连接/截图各阶段耗时，定位"经常超时"到底慢在哪一步。
 *
 * 前提：
 *   1. 微信开发者工具已打开，并打开了一个小程序项目
 *   2. 设置 → 安全设置 → 开启"CLI/HTTP 调用"（服务端口）
 *
 * 用法：
 *   node tests/simulation/diagnose-timeout.mjs                 # 自动扫描常见端口
 *   DEVTOOLS_PORT=62777 node tests/simulation/diagnose-timeout.mjs   # 指定端口
 */

import net from 'node:net'
import automator from 'miniprogram-automator'

const now = () => Date.now()
const fmt = (ms) => `${ms}ms`

// 常见的 DevTools 自动化端口：9420(CLI auto 模式) + GUI 服务端口常见值
const CANDIDATE_PORTS = process.env.DEVTOOLS_PORT
  ? [Number(process.env.DEVTOOLS_PORT)]
  : [9420, 62777, 40000, 35562, 51601, 8080]

// 1. TCP 探测：哪些端口真的有人监听
function probe(port) {
  return new Promise((resolve) => {
    const sock = new net.Socket()
    let done = false
    const finish = (ok) => { if (done) return; done = true; sock.destroy(); resolve(ok) }
    sock.setTimeout(800)
    sock.on('connect', () => finish(true))
    sock.on('timeout', () => finish(false))
    sock.on('error', () => finish(false))
    sock.connect(port, '127.0.0.1')
  })
}

async function main() {
  console.log('=== 步骤1：扫描哪个端口有 DevTools 自动化服务在监听 ===')
  let livePort = null
  for (const p of CANDIDATE_PORTS) {
    const ok = await probe(p)
    console.log(`  127.0.0.1:${p} → ${ok ? '✅ 监听中' : '✗ 无'}`)
    if (ok && !livePort) livePort = p
  }
  if (!livePort) {
    console.log('\n❌ 没有任何候选端口在监听。')
    console.log('   请确认：DevTools 已打开 + 设置里开启了"CLI/HTTP 调用"。')
    console.log('   然后在 DevTools 设置页找到实际"服务端口"，用 DEVTOOLS_PORT=<端口> 重跑本脚本。')
    process.exit(1)
  }
  console.log(`\n→ 使用端口 ${livePort}\n`)

  // 2. 测连接耗时
  console.log('=== 步骤2：连接耗时 ===')
  let t = now()
  let mp
  try {
    mp = await automator.connect({ wsEndpoint: `ws://127.0.0.1:${livePort}` })
    console.log(`  ✅ connect 成功：${fmt(now() - t)}`)
  } catch (e) {
    console.log(`  ❌ connect 失败：${fmt(now() - t)} — ${e.message}`)
    process.exit(1)
  }

  // 3. 测各操作耗时
  console.log('\n=== 步骤3：各操作真实耗时 ===')
  const time = async (label, fn) => {
    const t0 = now()
    try { await fn(); console.log(`  ${label}: ${fmt(now() - t0)}`) }
    catch (e) { console.log(`  ${label}: ❌ ${fmt(now() - t0)} — ${e.message}`) }
  }

  await time('currentPage()        ', () => mp.currentPage())
  await time('systemInfo()         ', () => mp.systemInfo())
  await time('pageStack()          ', () => mp.pageStack())
  await time('screenshot(普通)     ', () => mp.screenshot({ path: '/tmp/diag-shot.png' }))
  await time('screenshot(fullPage) ', () => mp.screenshot({ path: '/tmp/diag-shot-full.png', fullPage: true }))
  await time('screenshot(base64)   ', () => mp.screenshot())

  console.log('\n=== 诊断结论 ===')
  console.log('  看上面哪一步耗时异常（>5s 即可疑）。')
  console.log('  - connect 慢 → 端口/握手问题')
  console.log('  - screenshot 慢、其他快 → SDK 截图编码慢（jimp/fullPage）')
  console.log('  - 全部慢 → DevTools 整体卡 / 机器负载 / 基础库版本')

  await mp.disconnect().catch(() => {})
  process.exit(0)
}

main().catch((e) => { console.error('脚本异常：', e); process.exit(1) })
