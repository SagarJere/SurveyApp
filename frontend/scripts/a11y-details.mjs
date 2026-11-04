/**
 * Print the elements behind failing Lighthouse accessibility audits for one page.
 *   node scripts/a11y-details.mjs <baseUrl> <path> <employeeId> [mobile|desktop]
 */
import os from 'node:os'
import path from 'node:path'
import { rmSync } from 'node:fs'

import lighthouse from 'lighthouse'
import { chromium } from 'playwright'

const [BASE, URL_PATH, EMPLOYEE = 'E1002', FORM = 'desktop'] = process.argv.slice(2)
const PORT = 9334

const login = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ employee_id: EMPLOYEE }),
}).then((r) => r.json())

const profile = path.join(os.tmpdir(), `pulse-a11y-${process.pid}`)
const context = await chromium.launchPersistentContext(profile, {
  headless: true,
  args: [`--remote-debugging-port=${PORT}`],
})
try {
  const page = context.pages()[0] ?? (await context.newPage())
  await page.goto(`${BASE}/login`)
  await page.evaluate((t) => localStorage.setItem('survey-app.access-token', t), login.access_token)
  const mobile = FORM === 'mobile'
  const { lhr } = await lighthouse(`${BASE}${URL_PATH}`, {
    port: PORT,
    output: 'json',
    logLevel: 'error',
    onlyCategories: ['accessibility'],
    disableStorageReset: true,
    formFactor: FORM,
    screenEmulation: mobile
      ? { mobile: true, width: 375, height: 812, deviceScaleFactor: 2, disabled: false }
      : { mobile: false, width: 1280, height: 860, deviceScaleFactor: 1, disabled: false },
  })
  for (const audit of Object.values(lhr.audits)) {
    if (audit.score === null || audit.score === 1 || audit.scoreDisplayMode !== 'binary') continue
    console.log(`\n${audit.id}`)
    for (const item of audit.details?.items ?? []) {
      console.log(
        `  ${item.node?.snippet?.slice(0, 160)}\n    ${item.node?.explanation?.split('\n').slice(0, 2).join(' | ')}`,
      )
    }
  }
} finally {
  await context.close()
  rmSync(profile, { recursive: true, force: true })
}
