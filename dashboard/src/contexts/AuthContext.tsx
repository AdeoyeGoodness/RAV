'use client'

import React, { createContext, useContext, useState, useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { User, getCurrentUser, userLogout } from '@/lib/api'

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
                // Try to hydrate session from HttpOnly Cookie
                const user = await getCurrentUser()
                setUser(user)
                if (user.organization_id) {
                    localStorage.setItem('rav_organization_id', user.organization_id)
                }
            } catch (error) {
                // 401 Unauthorized -> No active session
                setUser(null)
                localStorage.removeItem('rav_organization_id')
            } finally {
                setIsLoading(false)
            }
        }
        checkAuth()
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
        // Token is now in HttpOnly Cookie, we just update state
        // Token arg is kept for signature compatibility but ignored
        setUser(user)
        setToken(null) // Token is not accessible to JS
        if (user.organization_id) {
            localStorage.setItem('rav_organization_id', user.organization_id)
        } else {
            localStorage.removeItem('rav_organization_id')
        }
        router.push('/')
    }

    const logout = async () => {
        try {
            await userLogout()
        } catch (e) {
            console.error("Logout failed", e)
        }
        setToken(null)
        setUser(null)
        localStorage.removeItem('rav_token') // Cleanup legacy
        localStorage.removeItem('rav_user') // Cleanup legacy
        localStorage.removeItem('rav_organization_id')
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
