import { createBrowserRouter, type RouteObject } from 'react-router'

import { PageLoader } from '@/components/page-loader'
import { MySurveysPage } from '@/features/respond/MySurveysPage'
import { SurveysHomePage } from '@/features/surveys-home/SurveysHomePage'
import { SurveyNotFoundPage } from '@/features/surveys/SurveyNotFoundPage'

import { AppShell } from './layouts/AppShell'
import { NotFoundPage } from './pages/NotFoundPage'
import { RouteErrorPage } from './pages/RouteErrorPage'

/**
 * Route groups (see docs/02-architecture.md):
 *   /                            My surveys (everyone)
 *   /s/:surveyId                 take a survey (lazy, separate chunk)
 *   /admin/surveys               surveys home (HR/Admin)
 *   /admin/surveys/:id/edit      builder
 *   /admin/surveys/:id/results   results dashboard
 */
export const routes: RouteObject[] = [
  {
    errorElement: <RouteErrorPage />,
    HydrateFallback: PageLoader,
    children: [
      {
        path: '/s/:surveyId',
        lazy: async () => {
          const { RespondentLayout } = await import('@/features/respond/respondent-chunk')
          return { Component: RespondentLayout }
        },
        children: [
          {
            index: true,
            lazy: async () => {
              const { SurveyUnavailablePage } = await import('@/features/respond/respondent-chunk')
              return { Component: SurveyUnavailablePage }
            },
          },
        ],
      },
      {
        Component: AppShell,
        children: [
          { index: true, Component: MySurveysPage },
          {
            path: 'admin',
            children: [
              { path: 'surveys', Component: SurveysHomePage },
              { path: 'surveys/:surveyId/edit', Component: SurveyNotFoundPage },
              { path: 'surveys/:surveyId/results', Component: SurveyNotFoundPage },
            ],
          },
          { path: '*', Component: NotFoundPage },
        ],
      },
    ],
  },
]

export function createAppRouter() {
  return createBrowserRouter(routes)
}

export type AppRouter = ReturnType<typeof createAppRouter>
