import ExchangeBinance from '@web3icons/react/icons/exchanges/ExchangeBinance'
import ExchangeBybit from '@web3icons/react/icons/exchanges/ExchangeBybit'
import ExchangeOkx from '@web3icons/react/icons/exchanges/ExchangeOkx'
import ExchangeGateIo from '@web3icons/react/icons/exchanges/ExchangeGateIo'
import ExchangeBitget from '@web3icons/react/icons/exchanges/ExchangeBitget'
import type { SupportedExchange } from './api'

// Real brand marks (@web3icons/react, MIT) + each brand's own accent color
// (read directly off the official "branded" SVG fill values) + a stable link
// to that exchange's own API-key management page. Shared between Profile.tsx
// (connection cards) and ExchangeDetails.tsx (the account-details page) so
// there's one source of truth for logos/colors instead of two.
export const EXCHANGES: {
  key: SupportedExchange
  label: string
  icon: typeof ExchangeBinance
  accent: string
  apiKeyUrl: string
}[] = [
  { key: 'binance', label: 'Binance', icon: ExchangeBinance, accent: '#F0B90B', apiKeyUrl: 'https://www.binance.com/en/my/settings/api-management' },
  { key: 'bybit', label: 'Bybit', icon: ExchangeBybit, accent: '#F6A500', apiKeyUrl: 'https://www.bybit.com/app/user/api-management' },
  { key: 'okx', label: 'OKX', icon: ExchangeOkx, accent: '#888888', apiKeyUrl: 'https://www.okx.com/account/my-api' },
  { key: 'gateio', label: 'Gate.io', icon: ExchangeGateIo, accent: '#2354E6', apiKeyUrl: 'https://www.gate.com/myaccount/apiv4keys' },
  { key: 'bitget', label: 'Bitget', icon: ExchangeBitget, accent: '#00F0FF', apiKeyUrl: 'https://www.bitget.com/api-doc/user/apikey' },
]

export const NEEDS_PASSPHRASE: SupportedExchange[] = ['okx', 'bitget']

/**
 * Bybit's "branded" mark is white-fill (designed for a dark background) -
 * invisible on our light logo chip. Every other exchange's branded mark is
 * colored/dark and reads fine there. Use Bybit's "mono" variant in solid
 * black instead - still the real official wordmark, just the variant that
 * actually has contrast against a light chip.
 */
export function ExchangeLogo({ exchangeKey, icon: Icon, size }: { exchangeKey: SupportedExchange; icon: typeof EXCHANGES[number]['icon']; size: number }) {
  if (exchangeKey === 'bybit') return <Icon variant="mono" color="#000" size={size} />
  return <Icon variant="branded" size={size} />
}
