import { useState } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import Landing from './pages/Landing'
import Dashboard from './pages/Dashboard'
import Catalog from './pages/Catalog'
import Checkout from './pages/Checkout'
import Merchant from './pages/Merchant'
import MerchantOnboard from './pages/MerchantOnboard'

export default function App() {
  const [wallet, setWallet] = useState<string | null>(null)

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout wallet={wallet} onConnected={setWallet} onLogout={() => setWallet(null)} />}>
          <Route path="/" element={<Landing />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/catalog" element={<Catalog />} />
          <Route path="/checkout" element={<Checkout />} />
          <Route path="/merchant" element={<Merchant />} />
          <Route path="/merchant/onboard" element={<MerchantOnboard />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
