import { createBrowserRouter, type RouteObject } from 'react-router'

import { PageLoader } from '@/components/page-loader'
import { LoginPage } from '@/features/auth/LoginPage'
import { RequireAuth } from '@/features/auth/RequireAuth'
import { RequireRole } from '@/features/auth/RequireRole'
import { SURVEY_MANAGER_ROLES } from '@/features/auth/types'
import { MySurveysPage } from '@/features/respond/MySurveysPage'
import { SurveysHomePage } from '@/features/surveys-home/SurveysHomePage'
import { SurveyNotFoundPage } from '@/features/surveys/SurveyNotFoundPage'

import { AppShell } from './layouts/AppShell'
import { NotFoundPage } from './pages/NotFoundPage'
import { RouteErrorPage } from './pages/RouteErrorPage'

/**
 * Route groups (see docs/02-architecture.md):
 *   /login                       sign in (public)
 *   /                            My surveys (everyone signed in)
 *   /s/:surveyId                 take a survey (lazy, separate chunk)
 *   /admin/surveys               surveys home (HR/Admin)
 *   /admin/surveys/:id/edit      builder (HR/Admin)
 *   /admin/surveys/:id/results   results dashboard (HR/Admin)
 */
export const routes: RouteObject[] = [
  {
    errorElement: <RouteErrorPage />,
    HydrateFallback: PageLoader,
    children: [
      { path: '/login', Component: LoginPage },
      {
        Component: RequireAuth,
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
                  const { SurveyUnavailablePage } =
                    await import('@/features/respond/respondent-chunk')
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
                element: <RequireRole roles={SURVEY_MANAGER_ROLES} />,
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
    ],
  },
]

export function createAppRouter() {
  return createBrowserRouter(routes)
}
