'use client'

import React, { createContext, useContext, useState, useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { User, getCurrentUser, userLogout, setApiAuthority } from '@/lib/api'

interface AuthContextType {
    user: User | null
    token: string | null
    login: (token: string, user: User) => void
    logout: () => void
    isLoading: boolean
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [user, setUser] = useState<User | null>(null)
    const [token, setToken] = useState<string | null>(null)
    const [isLoading, setIsLoading] = useState(true)
    const router = useRouter()
    const pathname = usePathname()

    useEffect(() => {
        const checkAuth = async () => {
            try {
                // Authority comes from the backend/JWT, not localStorage
                const user = await getCurrentUser()
                setUser(user)
                setApiAuthority(user.role, user.organization_id)
                if (user.organization_id) {
                    localStorage.setItem('rav_organization_id', user.organization_id)
                }
            } catch (error: any) {
                setUser(null)
                setApiAuthority(null, null)
                localStorage.removeItem('rav_organization_id')

                const status = error.response?.status;
                if (status === 402) {
                    router.push('/login?error=expired')
                } else if (status === 403) {
                    router.push('/login?error=suspended')
                }
            } finally {
                setIsLoading(false)
            }
        }
        checkAuth()

        // CROSS-TAB SYNC: Listen for auth changes in other tabs
        const handleStorageChange = (e: StorageEvent) => {
            if (e.key === 'rav_auth_sync') {
                // If another tab logged out or changed, we must re-verify or reload
                window.location.reload()
            }
        }
        window.addEventListener('storage', handleStorageChange)
        return () => window.removeEventListener('storage', handleStorageChange)
    }, [])

    useEffect(() => {
        if (!isLoading) {
            if (!user && pathname !== '/login') {
                router.push('/login')
            } else if (user && pathname === '/login') {
                router.push('/')
            }
        }
    }, [user, isLoading, pathname, router])

    const login = (token: string, user: User) => {
        setUser(user)
        setApiAuthority(user.role, user.organization_id)
        setToken(null)
        // Broadcast change to other tabs
        localStorage.setItem('rav_auth_sync', Date.now().toString())
        router.push('/')
    }

    const logout = async () => {
        try {
            await userLogout()
        } catch (e) {
            console.error("Logout failed", e)
        }
        setUser(null)
        setToken(null)
        setApiAuthority(null, null)
        localStorage.removeItem('rav_organization_id')
        // Cleanup legacy keys
        localStorage.removeItem('rav_token')
        localStorage.removeItem('rav_user')
        // Broadcast logout to other tabs
        localStorage.setItem('rav_auth_sync', Date.now().toString())
        router.push('/login')
    }

    return (
        <AuthContext.Provider value={{ user, token, login, logout, isLoading }}>
            {children}
        </AuthContext.Provider>
    )
}

export function useAuth() {
    const context = useContext(AuthContext)
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider')
    }
    return context
}
