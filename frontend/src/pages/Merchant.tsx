import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { MOCK_PAYOUTS, MOCK_SUBSCRIBERS, MOCK_CHART_DATA } from '../lib/mockData'
import { formatUSDC, shortAddr, shortHash, formatTs, STATUS_LABEL, STATUS_COLOR } from '../lib/format'
import { Edit } from 'lucide-react'

const MERCHANT = '0xDeF0abcd1234567890abcdef1234567890DEF012'

const STATS = [
  { label: 'Total Collected', value: '$48,240.00' },
  { label: 'Total Paid Out', value: '$47,031.00' },
  { label: 'Protocol Fees', value: '$1,209.00' },
  { label: 'Subscribers', value: '27' },
]

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-[#111111] border border-[#1e1e1e] rounded-sm px-3 py-2 text-xs">
      <p className="text-[#9b9b9b] mb-1">{label}</p>
      <p className="font-mono text-[#00d4aa]">${payload[0].value.toFixed(2)}</p>
    </div>
  )
}

export default function Merchant() {
  return (
    <div className="px-6 py-8 max-w-6xl">
      {/* Header */}
      <div className="flex items-start justify-between mb-7">
        <div>
          <p className="text-xs text-[#9b9b9b] uppercase tracking-widest mb-1">Merchant</p>
          <h1 className="text-2xl font-semibold text-[#e8e8e8]">Dashboard</h1>
          <p className="text-sm text-[#9b9b9b] mt-1 font-mono">{shortAddr(MERCHANT)}</p>
        </div>
        <button className="flex items-center gap-2 bg-[#111111] border border-[#1e1e1e] text-[#9b9b9b] hover:text-[#e8e8e8] text-xs font-medium px-3 py-2 rounded-sm transition-colors">
          <Edit size={13} /> Edit Profile
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
        {STATS.map(s => (
          <div key={s.label} className="bg-[#111111] border border-[#1e1e1e] rounded-sm p-4">
            <p className="text-xs text-[#9b9b9b] uppercase tracking-widest mb-2">{s.label}</p>
            <p className="text-xl font-mono font-bold text-[#e8e8e8]">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Revenue chart */}
      <div className="bg-[#111111] border border-[#1e1e1e] rounded-sm p-5 mb-8">
        <p className="text-xs text-[#9b9b9b] uppercase tracking-widest mb-5">Revenue · 30 Days</p>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={MOCK_CHART_DATA} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
            <CartesianGrid stroke="#1e1e1e" strokeDasharray="0" vertical={false} />
            <XAxis
              dataKey="day"
              tick={{ fill: '#9b9b9b', fontSize: 10, fontFamily: 'JetBrains Mono' }}
              tickLine={false}
              axisLine={{ stroke: '#1e1e1e' }}
              interval={4}
            />
            <YAxis
              tick={{ fill: '#9b9b9b', fontSize: 10, fontFamily: 'JetBrains Mono' }}
              tickLine={false}
              axisLine={false}
              tickFormatter={v => `$${v}`}
            />
            <Tooltip content={<CustomTooltip />} />
            <Line
              type="monotone"
              dataKey="revenue"
              stroke="#00d4aa"
              strokeWidth={1.5}
              dot={false}
              activeDot={{ r: 3, fill: '#00d4aa', stroke: 'none' }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Payouts table */}
      <div className="mb-8">
        <p className="text-xs text-[#9b9b9b] uppercase tracking-widest mb-3 flex items-center gap-3">
          Recent Payouts <span className="flex-1 h-px bg-[#1e1e1e]" />
        </p>
        <div className="bg-[#111111] border border-[#1e1e1e] rounded-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>Date</th><th>Charge ID</th><th>Gross</th><th>Fee</th><th>Net</th><th>Tx Hash</th>
                </tr>
              </thead>
              <tbody>
                {MOCK_PAYOUTS.map(p => (
                  <tr key={p.id}>
                    <td className="text-xs text-[#9b9b9b]">{formatTs(p.timestamp)}</td>
                    <td className="font-mono text-xs text-[#9b9b9b]">#{p.chargeId}</td>
                    <td className="font-mono">{formatUSDC(p.gross)}</td>
                    <td className="font-mono text-[#9b9b9b] text-xs">{formatUSDC(p.fee)}</td>
                    <td className="font-mono text-[#00d4aa]">{formatUSDC(p.net)}</td>
                    <td className="font-mono text-xs text-[#9b9b9b]">{shortHash(p.txHash)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Subscribers */}
      <div>
        <p className="text-xs text-[#9b9b9b] uppercase tracking-widest mb-3 flex items-center gap-3">
          Subscribers <span className="flex-1 h-px bg-[#1e1e1e]" />
        </p>
        <div className="bg-[#111111] border border-[#1e1e1e] rounded-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>Buyer</th><th>Plan</th><th>Amount/cycle</th><th>Status</th><th>Since</th>
                </tr>
              </thead>
              <tbody>
                {MOCK_SUBSCRIBERS.map((s, i) => (
                  <tr key={i}>
                    <td className="font-mono text-xs">{s.buyer}</td>
                    <td className="text-xs text-[#e8e8e8]">{s.plan}</td>
                    <td className="font-mono">{formatUSDC(s.amount)}</td>
                    <td>
                      <span className={`text-[10px] font-medium px-2 py-0.5 rounded-sm ${STATUS_COLOR[s.status]}`}>
                        {STATUS_LABEL[s.status]}
                      </span>
                    </td>
                    <td className="text-xs text-[#9b9b9b]">{formatTs(s.since)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
