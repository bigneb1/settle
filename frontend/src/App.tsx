import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { WalletProvider } from './context/WalletContext'
import Layout from './components/Layout'
import Landing from './pages/Landing'
import Dashboard from './pages/Dashboard'
import Catalog from './pages/Catalog'
import Checkout from './pages/Checkout'
import Merchant from './pages/Merchant'
import MerchantOnboard from './pages/MerchantOnboard'
import AuthCallback from './pages/AuthCallback'

export default function App() {
  return (
    <WalletProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/auth/callback" element={<AuthCallback />} />
          <Route element={<Layout />}>
            <Route path="/" element={<Landing />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/catalog" element={<Catalog />} />
            <Route path="/checkout" element={<Checkout />} />
            <Route path="/merchant" element={<Merchant />} />
            <Route path="/merchant/onboard" element={<MerchantOnboard />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </WalletProvider>
  )
}
