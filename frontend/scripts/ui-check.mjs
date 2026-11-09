/**
 * Browser check: screenshots at desktop, phone (375px) and dark mode, plus Lighthouse
 * accessibility on the builder's Preview. Needs the dev servers running (make api, make web).
 *
 *   node scripts/ui-check.mjs [baseUrl] [outDir]
 *
 * Signs in as the dev HR account E1002 and makes sure the "Workplace pulse" sample survey
 * exists (it's left in place to try). A temporary one-question-layout copy is deleted at the end.
 */
import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import lighthouse from 'lighthouse'
import { chromium } from 'playwright'

const BASE = process.argv[2] ?? 'http://localhost:5173'
const OUT = path.resolve(process.argv[3] ?? 'ui-check')
const PORT = 9333
const SAMPLE_TITLE = 'Workplace pulse, Q4 2026'
const pulse = JSON.parse(
  readFileSync(new URL('../../shared/test-cases/workplace-pulse.json', import.meta.url), 'utf8'),
).draft

async function api(method, url, token, body) {
  const response = await fetch(`${BASE}/api${url}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!response.ok && response.status !== 204) {
    throw new Error(`${method} ${url} -> ${response.status} ${await response.text()}`)
  }
  return response.status === 204 ? null : response.json()
}

async function surveyWith(token, draft) {
  const survey = await api('POST', '/surveys', token)
  await api('PUT', `/surveys/${survey.id}/draft`, token, {
    draft,
    draft_updated_at: survey.draft_updated_at,
  })
  return survey.id
}

const TEST_ACCOUNTS = [
  ['E1001', 'Asha Rao', 'People', 'Pune'],
  ['E1002', 'Vikram Mehta', 'People', 'Pune'],
  ['E2001', 'Priya Nair', 'Engineering', 'Pune'],
  ['E2002', 'Rahul Sharma', 'Engineering', 'Delhi'],
  ['E2003', 'Meera Iyer', 'Sales', 'Mumbai'],
  ['E2004', 'Arjun Singh', 'Sales', 'Delhi'],
  ['E2005', 'Fatima Khan', 'Finance', 'Mumbai'],
]

function isoDay(offsetDays) {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Publish the sample once, open from today for 30 days, with the dev test accounts as its
 * audience, so it can be tried as an employee. Left alone if it's already published.
 */
async function publishSample(token, surveyId) {
  const detail = await api('GET', `/surveys/${surveyId}`, token)
  if (detail.status !== 'draft') return
  const draft = {
    ...detail.draft,
    settings: { ...detail.draft.settings, opens_at: isoDay(0), closes_at: isoDay(30) },
  }
  await api('PUT', `/surveys/${surveyId}/draft`, token, {
    draft,
    draft_updated_at: detail.draft_updated_at,
  })
  const csv = [
    'EmployeeId,Name,Department,Location',
    ...TEST_ACCOUNTS.map((r) => r.join(',')),
  ].join('\n')
  const form = new FormData()
  form.append('file', new Blob([csv], { type: 'text/csv' }), 'test-accounts.csv')
  const upload = await fetch(`${BASE}/api/surveys/${surveyId}/audience/uploads?mode=replace`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  })
  const preview = await upload.json()
  await api('POST', `/surveys/${surveyId}/audience/uploads/${preview.upload_id}/apply`, token)
  await api('POST', `/surveys/${surveyId}/publish`, token)
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const { access_token: token } = await api('POST', '/auth/login', null, { employee_id: 'E1002' })

  const existing = (await api('GET', '/surveys', token)).find((s) => s.title === SAMPLE_TITLE)
  const sampleId = existing?.id ?? (await surveyWith(token, pulse))
  await publishSample(token, sampleId)
  const stepId = await surveyWith(token, {
    ...pulse,
    title: 'UI check (one question at a time)',
    settings: { ...pulse.settings, layout: 'step', show_navigator: true },
  })

  const profile = path.join(os.tmpdir(), `pulse-ui-check-${process.pid}`)
  const context = await chromium.launchPersistentContext(profile, {
    headless: true,
    args: [`--remote-debugging-port=${PORT}`],
    viewport: { width: 1280, height: 860 },
  })
  const results = []
  try {
    const page = context.pages()[0] ?? (await context.newPage())
    await page.goto(`${BASE}/login`)
    await page.evaluate((t) => localStorage.setItem('survey-app.access-token', t), token)

    const shot = async (
      name,
      url,
      { width = 1280, height = 860, dark = false, full = true, wait } = {},
    ) => {
      await page.setViewportSize({ width, height })
      await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' })
      await page.goto(`${BASE}${url}`, { waitUntil: 'networkidle' })
      if (wait) await page.waitForSelector(wait)
      await page.waitForTimeout(400)
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      )
      await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: full })
      results.push({ name, horizontalOverflowPx: overflow })
    }

    const edit = `/admin/surveys/${sampleId}/edit`
    await shot('home-desktop', '/admin/surveys', { wait: 'main li' })
    await shot('home-375', '/admin/surveys', { width: 375, height: 812, wait: 'main li' })
    await shot('builder-questions-desktop', edit, { wait: '[data-survey-title]' })
    await shot('builder-questions-375', edit, {
      width: 375,
      height: 812,
      wait: '[data-survey-title]',
    })
    await shot('builder-theme-desktop', `${edit}?tab=theme`, {
      wait: 'button[aria-pressed="true"] img',
    })
    await shot('builder-theme-375', `${edit}?tab=theme`, {
      width: 375,
      height: 812,
      wait: 'button[aria-pressed="true"] img',
    })
    await shot('builder-settings-desktop', `${edit}?tab=settings`, { wait: 'input[type="date"]' })
    await shot('preview-desktop', `${edit}?mode=preview`, { wait: 'article h1' })
    await shot('preview-375', `${edit}?mode=preview`, {
      width: 375,
      height: 812,
      wait: 'article h1',
    })
    await shot('preview-dark', `${edit}?mode=preview`, { dark: true, wait: 'article h1' })
    await shot('preview-step-desktop', `/admin/surveys/${stepId}/edit?mode=preview`, {
      wait: 'nav[aria-label="Questions"]',
    })
    await shot('preview-step-375-dark', `/admin/surveys/${stepId}/edit?mode=preview`, {
      width: 375,
      height: 812,
      dark: true,
      wait: 'nav[aria-label="Questions"]',
    })

    await shot('builder-audience-desktop', `${edit}?tab=audience`, { wait: 'main li' })
    await shot('builder-audience-375', `${edit}?tab=audience`, {
      width: 375,
      height: 812,
      wait: 'main li',
    })

    // Results. Question cards only appear once 5 or more people have responded
    // (`uv run python -m app.scripts.seed_responses <survey id>` adds test responses in dev).
    const results_ = `/admin/surveys/${sampleId}/results`
    const resultsReady = 'main section[aria-label="Filters"]'
    await shot('results-desktop', results_, { wait: resultsReady })
    await shot('results-375', results_, { width: 375, height: 812, wait: resultsReady })
    await shot('results-dark', results_, { dark: true, wait: resultsReady })
    // Nobody is "not recorded", so this is an empty group. The sample isn't anonymous, so it
    // shows empty widgets rather than the small-group notice (anonymous surveys only).
    await shot('results-empty-group-375', `${results_}?department=`, {
      width: 375,
      height: 812,
      wait: resultsReady,
    })

    // Lighthouse accessibility, as HR.
    const audits = [
      ['surveys home, phone', '/admin/surveys', 'mobile'],
      ['results, desktop', results_, 'desktop'],
      ['results, phone', results_, 'mobile'],
      ['preview (section layout), desktop', `${edit}?mode=preview`, 'desktop'],
      ['preview (section layout), phone', `${edit}?mode=preview`, 'mobile'],
      ['preview (one question), phone', `/admin/surveys/${stepId}/edit?mode=preview`, 'mobile'],
      ['builder questions, desktop', edit, 'desktop'],
      ['builder theme, desktop', `${edit}?tab=theme`, 'desktop'],
      ['builder settings, desktop', `${edit}?tab=settings`, 'desktop'],
      ['builder audience, desktop', `${edit}?tab=audience`, 'desktop'],
    ]
    await runAudits(audits)

    // As an employee in the sample's audience.
    const { access_token: employeeToken } = await api('POST', '/auth/login', null, {
      employee_id: 'E2001',
    })
    await page.evaluate((t) => localStorage.setItem('survey-app.access-token', t), employeeToken)
    await shot('my-surveys-desktop', '/', { wait: 'main li' })
    await shot('my-surveys-375', '/', { width: 375, height: 812, wait: 'main li' })
    // E2001 may already have answered; then this shows the "thanks" screen instead.
    await shot('respond-desktop', `/s/${sampleId}`, { wait: 'h1' })
    await shot('respond-375', `/s/${sampleId}`, { width: 375, height: 812, wait: 'h1' })
    await shot('respond-375-dark', `/s/${sampleId}`, {
      width: 375,
      height: 812,
      dark: true,
      wait: 'h1',
    })
    await runAudits([
      ['my surveys, phone', '/', 'mobile'],
      ['take a survey, phone', `/s/${sampleId}`, 'mobile'],
      ['take a survey, desktop', `/s/${sampleId}`, 'desktop'],
    ])
  } finally {
    await context.close()
    rmSync(profile, { recursive: true, force: true })
    await api('DELETE', `/surveys/${stepId}`, token)
  }

  async function runAudits(audits) {
    for (const [label, url, formFactor] of audits) {
      const mobile = formFactor === 'mobile'
      const run = await lighthouse(`${BASE}${url}`, {
        port: PORT,
        output: 'json',
        logLevel: 'error',
        onlyCategories: ['accessibility'],
        disableStorageReset: true,
        formFactor,
        screenEmulation: mobile
          ? { mobile: true, width: 375, height: 812, deviceScaleFactor: 2, disabled: false }
          : { mobile: false, width: 1280, height: 860, deviceScaleFactor: 1, disabled: false },
      })
      const lhr = run.lhr
      const failing = Object.values(lhr.audits)
        .filter((a) => a.score !== null && a.score < 1 && a.scoreDisplayMode === 'binary')
        .map((a) => `${a.id}: ${a.title}`)
      results.push({
        name: `lighthouse ${label}`,
        accessibility: Math.round(lhr.categories.accessibility.score * 100),
        failing,
      })
    }
  }

  console.log(
    JSON.stringify({ sampleSurvey: `${BASE}/admin/surveys/${sampleId}/edit`, results }, null, 2),
  )
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
