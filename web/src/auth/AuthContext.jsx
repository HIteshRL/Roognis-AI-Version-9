import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { api } from '../api/client'

const AuthCtx = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const { user } = await api.me()
      setUser(user)
    } catch {
      setUser(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const login = async (role) => {
    const { user } = await api.login(role)
    setUser(user)
    return user
  }
  const logout = async () => {
    try {
      await api.logout()
    } finally {
      setUser(null)
    }
  }

  return <AuthCtx.Provider value={{ user, loading, login, logout, refresh }}>{children}</AuthCtx.Provider>
}

export const useAuth = () => useContext(AuthCtx)
