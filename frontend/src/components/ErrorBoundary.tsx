import { Component, type ReactNode } from 'react'

interface Props { children: ReactNode }
interface State { hasError: boolean; error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          height: '100%', gap: 12, padding: 40, textAlign: 'center',
        }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, color: 'var(--tx-primary)', margin: 0 }}>
            Something went wrong
          </h2>
          <p style={{ fontSize: 13, color: 'var(--tx-muted)', maxWidth: 400, margin: 0, lineHeight: 1.5 }}>
            Try refreshing the page or navigating to another section.
          </p>
          <p style={{ fontSize: 11, color: 'var(--tx-dim)', fontFamily: 'monospace', margin: 0 }}>
            {this.state.error?.message}
          </p>
        </div>
      )
    }
    return this.props.children
  }
}
