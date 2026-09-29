import { createContext, useContext, useState } from 'react'

const AuthContext = createContext(null)

/**
 * AURORA prototype sign-in. There is no server-side session: this only gates
 * the demo console and is stored in localStorage. It is deliberately labelled
 * as a demo credential so nobody mistakes it for an authenticated system.
 */
const DEMO_USER = {
  email: 'admin@aurora.local',
  password: 'admin123',
  name: 'Demo Operator',
  organization: 'AURORA prototype',
  role: 'Operations Officer',
}

const STORAGE_KEY = 'aurora-user'

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY) || localStorage.getItem('naviglace-user')
      return saved ? JSON.parse(saved) : null
    } catch {
      return null
    }
  })

  const login = ({ email, password, remember = true }) => {
    const inputEmail = (email ?? '').toLowerCase().trim()
    if (inputEmail === DEMO_USER.email && password === DEMO_USER.password) {
      const u = {
        name: DEMO_USER.name,
        email: DEMO_USER.email,
        organization: DEMO_USER.organization,
        role: DEMO_USER.role,
      }
      if (remember) localStorage.setItem(STORAGE_KEY, JSON.stringify(u))
      else localStorage.removeItem(STORAGE_KEY)
      setUser(u)
      return { ok: true }
    }
    return {
      ok: false,
      error: `Invalid email or password. Use ${DEMO_USER.email} / ${DEMO_USER.password}`,
    }
  }

  const signup = ({ fullName, email, organization }) => {
    const u = {
      name: fullName,
      email,
      organization,
      role: 'Operations Officer',
      demo: true,
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(u))
    setUser(u)
    return { ok: true }
  }

  const logout = () => {
    localStorage.removeItem(STORAGE_KEY)
    localStorage.removeItem('naviglace-user')
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, login, signup, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
