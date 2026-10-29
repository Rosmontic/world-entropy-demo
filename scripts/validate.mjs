import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright-core'

const root = process.cwd()
const artifacts = path.join(root, 'artifacts')
await mkdir(artifacts, { recursive: true })

const server = spawn('npm', ['run', 'dev', '--', '--port', '7100', '--strictPort'], {
  cwd: root,
  shell: true,
  stdio: 'pipe',
})
let serverOutput = ''
server.stdout.on('data', (chunk) => { serverOutput += chunk.toString() })
server.stderr.on('data', (chunk) => { serverOutput += chunk.toString() })

async function stopServer() {
  if (server.killed || server.exitCode !== null) return
  if (process.platform === 'win32') {
    await new Promise((resolve) => {
      const killer = spawn('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' })
      killer.on('close', resolve)
      killer.on('error', resolve)
    })
  } else {
    server.kill('SIGTERM')
  }
}

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch('http://127.0.0.1:7100/')
      if (response.ok) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`开发服务器未启动：${serverOutput}`)
}

let browser
try {
  await waitForServer()
  browser = await chromium.launch({
    executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless: true,
    args: ['--disable-gpu'],
  })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })

  await page.goto('http://127.0.0.1:7100/', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: '开始校订' }).waitFor()
  await page.screenshot({ path: path.join(artifacts, 'title.png'), fullPage: true })

  await page.getByRole('button', { name: '首次观测？阅读规则' }).click()
  await page.getByRole('heading', { name: '校订规则速查' }).waitFor()
  await page.getByRole('button', { name: '关闭' }).click()

  await page.getByRole('button', { name: '开始校订' }).click()

  await page.getByRole('button', { name: /卡牌库/ }).click()
  const libraryCards = await page.locator('.library-grid .game-card').count()
  if (libraryCards !== 13) throw new Error(`卡牌库应为 13 张，实际 ${libraryCards}`)
  await page.getByRole('textbox', { name: '搜索卡牌' }).fill('镜子')
  if (await page.locator('.library-grid .game-card').count() !== 1) throw new Error('卡牌搜索未正确过滤')
  await page.getByRole('button', { name: '关闭' }).click()
  await page.locator('.hand-row .game-card').first().waitFor()
  if (await page.locator('.hand-row .game-card').count() !== 5) throw new Error('开局手牌不是 5 张')
  if (await page.locator('.board-slot').count() !== 6) throw new Error('战场不是 6 个位置')

  const legalCard = page.locator('.hand-row .game-card:not(.illegal):not(.disabled)').first()
  await legalCard.click()
  await page.locator('.board-slot.active-slot').click()
  await page.locator('.board-slot.occupied').first().waitFor()
  await page.screenshot({ path: path.join(artifacts, 'gameplay.png'), fullPage: true })

  await page.getByRole('button', { name: '停止出牌' }).click()
  await page.getByRole('button', { name: '进入弃牌与保留' }).waitFor({ timeout: 30000 })
  await page.getByRole('button', { name: '进入弃牌与保留' }).click()
  await page.getByRole('button', { name: '完成校订，进入下一回合' }).waitFor()
  await page.getByRole('button', { name: '完成校订，进入下一回合' }).click()
  await page.getByText('第 2 回合', { exact: true }).waitFor()

  await page.getByRole('button', { name: '重新开始' }).click()
  await page.getByRole('button', { name: '停止出牌' }).click()
  await page.locator('.main-slot .card-id').filter({ hasText: 'O1000' }).waitFor()
  await page.screenshot({ path: path.join(artifacts, 'system-main.png'), fullPage: true })
  await page.getByRole('button', { name: '进入弃牌与保留' }).waitFor({ timeout: 30000 })
  await page.getByRole('button', { name: '进入弃牌与保留' }).click()
  await page.getByRole('button', { name: '完成校订，进入下一回合' }).click()
  await page.getByText('第 2 回合', { exact: true }).waitFor()

  const brokenImages = await page.locator('img').evaluateAll((images) => images.filter((image) => !image.complete || image.naturalWidth === 0).map((image) => image.src))
  if (brokenImages.length) throw new Error(`图片加载失败：${brokenImages.join(', ')}`)

  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: path.join(artifacts, 'mobile.png'), fullPage: true })
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  if (overflow > 2) throw new Error(`手机页面横向溢出 ${overflow}px`)
  if (errors.length) throw new Error(`浏览器错误：${errors.join(' | ')}`)

  const report = {
    ok: true,
    checks: ['标题页', '13 张卡牌库', '卡牌搜索', '规则弹窗', '5 张开局手牌', '6 个战场位置', '点击出牌', '系统备用主世界', 'AI 自动出牌', '逐张显现', '回合结算', '保留并进入下一回合', '图片加载', '手机布局'],
    screenshots: ['artifacts/title.png', 'artifacts/gameplay.png', 'artifacts/system-main.png', 'artifacts/mobile.png'],
    consoleErrors: errors,
  }
  await writeFile(path.join(artifacts, 'validation.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
} finally {
  await browser?.close()
  await stopServer()
}
