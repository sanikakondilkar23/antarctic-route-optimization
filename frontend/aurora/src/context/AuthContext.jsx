import { createContext, useContext, useState } from 'react'

const AuthContext = createContext(null)

const DEMO_USER = {
  email: 'admin@naviglace.ai',
  password: 'admin123',
  name: 'Admin User',
  organization: 'NCPOR (Demo)',
  role: 'Operations Officer',
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try {
      const saved = localStorage.getItem('naviglace-user') || localStorage.getItem('polaris-user')
      return saved ? JSON.parse(saved) : null
    } catch {
      return null
    }
  })

  const login = ({ email, password }) => {
    const inputEmail = email.toLowerCase().trim()
    if (
      (inputEmail === DEMO_USER.email || inputEmail === 'admin@polaris.ai') &&
      password === DEMO_USER.password
    ) {
      const u = {
        name: DEMO_USER.name,
        email: DEMO_USER.email,
        organization: DEMO_USER.organization,
        role: DEMO_USER.role,
      }
      localStorage.setItem('naviglace-user', JSON.stringify(u))
      setUser(u)
      return { ok: true }
    }
    return { ok: false, error: 'Invalid email or password. Use admin@naviglace.ai / admin123' }
  }

  const signup = ({ fullName, email, organization }) => {
    const u = { name: fullName, email, organization, role: 'Operations Officer' }
    localStorage.setItem('naviglace-user', JSON.stringify(u))
    setUser(u)
    return { ok: true }
  }

  const logout = () => {
    localStorage.removeItem('naviglace-user')
    localStorage.removeItem('polaris-user')
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