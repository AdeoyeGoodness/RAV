'use client'

import React, { createContext, useContext, useState, useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { User } from '@/lib/api'

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
        const savedToken = localStorage.getItem('rav_token')
        const savedUser = localStorage.getItem('rav_user')
        const savedOrgId = localStorage.getItem('rav_organization_id')

        if (savedToken && savedUser) {
            setToken(savedToken)
            setUser(JSON.parse(savedUser))
        }
        setIsLoading(false)
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
        setToken(token)
        setUser(user)
        localStorage.setItem('rav_token', token)
        localStorage.setItem('rav_user', JSON.stringify(user))
        if (user.organization_id) {
            localStorage.setItem('rav_organization_id', user.organization_id)
        } else {
            localStorage.removeItem('rav_organization_id')
        }
        router.push('/')
    }

    const logout = () => {
        setToken(null)
        setUser(null)
        localStorage.removeItem('rav_token')
        localStorage.removeItem('rav_user')
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
