import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { WalletProvider } from './context/WalletContext'
import Layout from './components/Layout'

// Route-level code splitting: each page is a separate chunk, so the heavy
// deps (recharts, ethers, viem, magic-sdk, supabase-js) only load for the
// route that needs them. The initial bundle is just the shell + theme + magic.
const Landing = lazy(() => import('./pages/Landing'))
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Catalog = lazy(() => import('./pages/Catalog'))
const Checkout = lazy(() => import('./pages/Checkout'))
const Merchant = lazy(() => import('./pages/Merchant'))
const MerchantOnboard = lazy(() => import('./pages/MerchantOnboard'))
const Dca = lazy(() => import('./pages/Dca'))
const Docs = lazy(() => import('./pages/Docs'))

function PageLoader() {
  return (
    <div className="flex items-center justify-center h-full min-h-[60vh] text-muted-foreground">
      <Loader2 size={20} className="animate-spin" />
    </div>
  )
}

export default function App() {
  return (
    <WalletProvider>
      <BrowserRouter>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route element={<Layout />}>
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/catalog" element={<Catalog />} />
              <Route path="/checkout" element={<Checkout />} />
              <Route path="/dca" element={<Dca />} />
              <Route path="/merchant" element={<Merchant />} />
              <Route path="/merchant/onboard" element={<MerchantOnboard />} />
              <Route path="/docs" element={<Docs />} />
            </Route>
          </Routes>
        </Suspense>
      </BrowserRouter>
    </WalletProvider>
  )
}
