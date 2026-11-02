import '@fontsource-variable/figtree'
import '@fontsource-variable/bricolage-grotesque/opsz.css'
import './index.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router/dom'

import { AppProviders } from './app/providers'
import { createAppRouter } from './app/router'

const container = document.getElementById('root')
if (!container) throw new Error('Root element #root is missing from index.html')

const router = createAppRouter()

createRoot(container).render(
  <StrictMode>
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>
  </StrictMode>,
)
