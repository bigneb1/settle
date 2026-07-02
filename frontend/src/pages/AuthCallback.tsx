import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { completeGoogleRedirect } from '../lib/magic'
import { useWallet } from '../context/WalletContext'

export default function AuthCallback() {
  const navigate = useNavigate()
  const { connect } = useWallet()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    completeGoogleRedirect()
      .then(address => {
        if (address) {
          connect(address)
          navigate('/dashboard', { replace: true })
        } else {
          setError('Google sign-in did not return a wallet address.')
        }
      })
      .catch(err => {
        console.error('[auth/callback] failed to complete Google login:', err)
        setError('Sign-in failed. Please try again.')
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="px-6 py-16 flex flex-col items-center justify-center text-center">
      {error ? (
        <>
          <p className="text-sm text-red-400 mb-4">{error}</p>
          <button
            onClick={() => navigate('/')}
            className="text-[#00d4aa] text-sm font-medium hover:underline"
          >
            Back to home
          </button>
        </>
      ) : (
        <>
          <Loader2 size={28} className="text-[#00d4aa] animate-spin mb-4" />
          <p className="text-sm text-[#9b9b9b]">Completing sign-in…</p>
        </>
      )}
    </div>
  )
}
