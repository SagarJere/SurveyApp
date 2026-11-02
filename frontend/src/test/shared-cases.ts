/// <reference types="node" />
import { readFileSync } from 'node:fs'
import path from 'node:path'

/** The repo's shared/test-cases folder, used by both the backend and frontend tests. */
const SHARED_DIR = path.resolve(import.meta.dirname, '../../../shared/test-cases')

/** Read a shared case file. Test-only: tests run in Node, the app never does this. */
export function sharedCases(name: string): unknown {
  return JSON.parse(readFileSync(path.join(SHARED_DIR, name), 'utf8'))
}
