import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

// Catches render-time exceptions (e.g. malformed data from Supabase/on-chain
// reads) so one bad item can't blank the entire app. Without this, an
// uncaught error anywhere in the routed tree unmounts everything.
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="px-6 py-16 flex flex-col items-center justify-center text-center">
          <AlertTriangle size={40} className="text-destructive mb-4" />
          <h2 className="text-lg font-semibold text-foreground mb-2">Something went wrong</h2>
          <p className="text-sm text-muted-foreground mb-6 max-w-md">
            {this.state.error.message || 'An unexpected error occurred while rendering this page.'}
          </p>
          <button
            onClick={() => {
              this.setState({ error: null })
              window.location.href = '/'
            }}
            className="bg-primary text-black font-semibold text-sm px-6 py-2.5 rounded-sm hover:bg-primary-hover transition-colors"
          >
            Back to Home
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
