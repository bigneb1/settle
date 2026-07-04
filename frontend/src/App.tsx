import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { WalletProvider } from './context/WalletContext'
import Layout from './components/Layout'
import Landing from './pages/Landing'
import Dashboard from './pages/Dashboard'
import Catalog from './pages/Catalog'
import Checkout from './pages/Checkout'
import Merchant from './pages/Merchant'
import MerchantOnboard from './pages/MerchantOnboard'
import Dca from './pages/Dca'
import Docs from './pages/Docs'

export default function App() {
  return (
    <WalletProvider>
      <BrowserRouter>
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
      </BrowserRouter>
    </WalletProvider>
  )
}
