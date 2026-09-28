import { useState } from 'react'
import { Outlet, Navigate } from 'react-router-dom'
import Sidebar from './Sidebar'
import TopNav from './TopNav'
import { useAuth } from '../../context/AuthContext'
import Disclaimer from '../ui/Disclaimer'

export default function AppLayout() {
  const { user } = useAuth()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  if (!user) return <Navigate to="/login" replace />

  return (
    <div className="min-h-screen bg-abyssal bg-abyssal-gradient text-white selection:bg-mint/30">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="flex min-h-screen flex-col lg:pl-72">
        <TopNav onMenu={() => setSidebarOpen(true)} />
        <main className="flex-1 px-4 py-6 md:px-6 lg:px-8">
          <div className="mx-auto max-w-[1520px]">
            <Outlet />
          </div>
        </main>
        <footer className="border-t border-white/10 px-4 py-4 md:px-6 lg:px-8 bg-abyssal-deck/40">
          <Disclaimer />
        </footer>
      </div>
    </div>
  )
}