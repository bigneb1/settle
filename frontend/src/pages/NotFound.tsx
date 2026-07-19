import { Link } from 'react-router-dom'
import SettleLogo from '../components/SettleLogo'

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-4 text-center px-4">
      <SettleLogo collapsed className="h-10 w-10 opacity-60" />
      <h1 className="text-2xl font-semibold text-foreground">Page not found</h1>
      <p className="text-sm text-muted-foreground max-w-sm">
        The page you're looking for doesn't exist or has moved.
      </p>
      <Link
        to="/"
        className="btn-primary font-bold"
      >
        Back to home
      </Link>
    </div>
  )
}
