import { useEffect, useState } from 'react'
import { Outlet, Navigate, useLocation } from 'react-router-dom'
import Sidebar from './Sidebar'
import TopNav from './TopNav'
import { useAuth } from '../../context/AuthContext'
import { cn } from '../../lib/utils'

const COLLAPSE_KEY = 'aurora-sidebar-collapsed'

/**
 * Authenticated application shell.
 *
 * Fixed viewport height with a persistent left sidebar that collapses to an
 * icon rail on desktop and becomes an off-canvas drawer on mobile. `main` is
 * the scroll container, so a page may either take the full height itself (the
 * map workspaces do) or flow naturally and let the shell scroll.
 */
export default function AppLayout() {
  const { user } = useAuth()
  const location = useLocation()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === '1'
    } catch {
      return false
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0')
    } catch {
      /* storage unavailable - collapse simply does not persist */
    }
  }, [collapsed])

  // Any navigation closes the mobile drawer.
  useEffect(() => {
    setSidebarOpen(false)
  }, [location.pathname])

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  return (
    <div className="flex h-screen min-h-[520px] overflow-hidden bg-graphite-900 text-white">
      <Sidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed((c) => !c)}
      />

      <div
        className={cn(
          'flex min-w-0 flex-1 flex-col transition-[padding] duration-200',
          collapsed ? 'lg:pl-[76px]' : 'lg:pl-72'
        )}
      >
        <TopNav onMenu={() => setSidebarOpen(true)} />

        <main className="scrollbar-thin relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
