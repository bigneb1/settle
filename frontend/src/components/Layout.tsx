import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import {
  Home, ShoppingBag, LayoutDashboard, Store, Menu, X, Wallet, LogOut, TrendingUp, BookOpen, UserCircle, Layers, Send, ChevronLeft, ChevronRight
} from 'lucide-react'
import SettleLogo from './SettleLogo'
import ThemeSwitcher from './ThemeSwitcher'
import { shortAddr } from '../lib/format'
import { logout } from '../lib/magic'
import { useWallet } from '../context/WalletContext'

const NAV = [
  { to: '/', label: 'Home', icon: Home, end: true },
  { to: '/catalog', label: 'Catalog', icon: ShoppingBag, end: false },
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, end: false },
  { to: '/account', label: 'Account', icon: Layers, end: false },
  { to: '/pay', label: 'Pay Any Address', icon: Send, end: false },
  { to: '/profile', label: 'Profile', icon: UserCircle, end: false },
  { to: '/dca', label: 'DCA', icon: TrendingUp, end: false },
  { to: '/merchant', label: 'Merchant', icon: Store, end: false },
  { to: '/docs', label: 'Docs', icon: BookOpen, end: false },
]

function Sidebar({ wallet, onConnect, onLogout, onClose, collapsed, onToggleCollapse }: {
  wallet: string | null
  onConnect: () => void
  onLogout: () => void
  onClose?: () => void
  collapsed?: boolean
  onToggleCollapse?: () => void
}) {
  return (
    <aside
      className={`flex flex-col h-full bg-background border-r border-border flex-shrink-0 transition-[width] duration-200 ${
        collapsed ? 'w-[68px]' : 'w-[220px]'
      }`}
    >
      {/* Logo */}
      <div className={`px-4 py-5 border-b border-border flex items-center gap-2 ${collapsed ? 'flex-col' : 'justify-between px-5'}`}>
        <SettleLogo collapsed={collapsed} className={collapsed ? 'h-7 w-7' : 'h-8 w-auto'} />
        <div className="flex items-center gap-2">
          <ThemeSwitcher />
          {onToggleCollapse && (
            <button
              onClick={onToggleCollapse}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              className="hidden lg:inline-flex text-muted-foreground hover:text-foreground transition-colors p-1"
            >
              {collapsed ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
            </button>
          )}
          {onClose && (
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground lg:hidden">
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={onClose}
            title={collapsed ? label : undefined}
            className={({ isActive }) =>
              `flex items-center gap-3 py-2.5 text-sm rounded-sm transition-colors border-l-2 ${
                collapsed ? 'justify-center px-2' : 'px-3 pl-[10px]'
              } ${
                isActive
                  ? 'text-primary bg-primary-subtle border-primary'
                  : 'text-muted-foreground hover:text-foreground hover:bg-card border-transparent'
              }`
            }
          >
            <Icon size={15} />
            {!collapsed && <span className="flex-1">{label}</span>}
          </NavLink>
        ))}
      </nav>

      {/* Wallet status */}
      <div className="border-t border-border px-4 py-4">
        {wallet ? (
          collapsed ? (
            <button
              onClick={onLogout}
              title="Disconnect"
              aria-label="Disconnect"
              className="w-full flex items-center justify-center text-muted-foreground hover:text-destructive transition-colors p-1.5"
            >
              <LogOut size={14} />
            </button>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-primary flex-shrink-0" />
                <span className="font-mono text-xs text-foreground truncate">{shortAddr(wallet)}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-muted-foreground">Arbitrum</span>
                <span className="text-border">·</span>
                <button
                  onClick={onLogout}
                  className="text-[10px] text-muted-foreground hover:text-destructive transition-colors flex items-center gap-1"
                >
                  <LogOut size={10} />Disconnect
                </button>
              </div>
            </div>
          )
        ) : collapsed ? (
          <button
            onClick={onConnect}
            title="Connect Wallet"
            aria-label="Connect Wallet"
            className="w-full flex items-center justify-center bg-card hover:bg-primary/10 border border-border hover:border-primary/40 text-primary p-2.5 rounded-sm transition-colors"
          >
            <Wallet size={13} />
          </button>
        ) : (
          <button
            onClick={onConnect}
            className="w-full flex items-center justify-center gap-2 bg-card hover:bg-primary/10 border border-border hover:border-primary/40 text-primary text-xs font-medium px-3 py-2.5 rounded-sm transition-colors"
          >
            <Wallet size={13} />
            Connect Wallet
          </button>
        )}
      </div>
    </aside>
  )
}

const SIDEBAR_COLLAPSED_KEY = 'settle-sidebar-collapsed'

export default function Layout() {
  const { address: wallet, disconnect, openConnect } = useWallet()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1')

  function handleLogout() {
    logout().catch(console.error)
    disconnect()
    setDrawerOpen(false)
  }

  function toggleCollapsed() {
    setCollapsed(prev => {
      const next = !prev
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? '1' : '0')
      return next
    })
  }

  return (
    <div className="flex h-full">
      {/* Desktop sidebar */}
      <div className="hidden lg:flex h-full fixed left-0 top-0 bottom-0 z-40">
        <Sidebar
          wallet={wallet}
          onConnect={openConnect}
          onLogout={handleLogout}
          collapsed={collapsed}
          onToggleCollapse={toggleCollapsed}
        />
      </div>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setDrawerOpen(false)} />
          <div className="relative z-10">
            <Sidebar wallet={wallet} onConnect={() => { openConnect(); setDrawerOpen(false) }} onLogout={handleLogout} onClose={() => setDrawerOpen(false)} />
          </div>
        </div>
      )}

      {/* Main content */}
      <div className={`flex-1 flex flex-col min-w-0 min-h-full transition-[margin] duration-200 ${collapsed ? 'lg:ml-[68px]' : 'lg:ml-[220px]'}`}>
        {/* Mobile header */}
        <header className="flex lg:hidden items-center justify-between px-4 py-3 border-b border-border bg-background sticky top-0 z-30">
          <div className="flex items-center gap-3">
            <button onClick={() => setDrawerOpen(true)} className="text-muted-foreground hover:text-foreground">
              <Menu size={20} />
            </button>
            <SettleLogo collapsed className="h-7 w-7" />
          </div>
          <div className="flex items-center gap-3">
            <ThemeSwitcher />
            <button
              onClick={openConnect}
              className="text-xs text-primary flex items-center gap-1"
            >
              {wallet ? <span className="font-mono">{shortAddr(wallet)}</span> : <><Wallet size={12} /> Connect</>}
            </button>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
