import React from 'react'

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null, info: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, info) {
    console.error('Aurora UI Error caught by boundary:', error, info)
    this.setState({ error, info })
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '100vh',
          backgroundColor: '#05182B',
          color: '#EAF6FF',
          padding: '40px 24px',
          fontFamily: 'system-ui, -apple-system, sans-serif'
        }}>
          <div style={{
            maxWidth: '800px',
            margin: '0 auto',
            backgroundColor: '#0A2540',
            border: '1px solid #FF4560',
            borderRadius: '12px',
            padding: '24px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
              <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#FF4560' }} />
              <h1 style={{ color: '#FF4560', fontSize: '20px', fontWeight: 'bold', margin: 0 }}>
                AURORA Render Notice
              </h1>
            </div>
            <p style={{ color: '#A9DFFF', fontSize: '14px', marginBottom: '16px' }}>
              {this.state.error?.message || 'An unexpected rendering error occurred.'}
            </p>
            <pre style={{
              background: '#04101D',
              padding: '16px',
              borderRadius: '8px',
              fontSize: '12px',
              overflowX: 'auto',
              color: '#FFB020',
              maxHeight: '300px'
            }}>
              {this.state.error?.stack}
            </pre>
            <div style={{ marginTop: '20px', display: 'flex', gap: '12px' }}>
              <button
                type="button"
                onClick={() => window.location.reload()}
                style={{
                  padding: '8px 18px',
                  background: '#22E5F0',
                  color: '#05182B',
                  fontWeight: 'bold',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  border: 'none'
                }}
              >
                Reload Page
              </button>
              <a
                href="/"
                style={{
                  padding: '8px 18px',
                  background: 'rgba(255,255,255,0.1)',
                  color: '#FFFFFF',
                  fontWeight: 'bold',
                  borderRadius: '6px',
                  textDecoration: 'none',
                  display: 'inline-block'
                }}
              >
                Return to Home
              </a>
            </div>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

export default ErrorBoundary
