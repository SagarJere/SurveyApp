/**
 * Everything the respondent route needs, in one module so Vite emits it as one lazy chunk.
 * Only import this through dynamic `import()` from the router.
 */
export { RespondentLayout } from '@/app/layouts/RespondentLayout'
export { RespondPage } from './RespondPage'
