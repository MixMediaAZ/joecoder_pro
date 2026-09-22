'use client'

import { Component, type ReactNode } from 'react'

export class PanelBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: Error) { console.error('Workspace panel failed:', error) }
  render() {
    if (this.state.failed) return <div role="alert" className="panel-notice"><p>This panel could not display its data. Your conversation remains available.</p><button onClick={() => this.setState({ failed: false })}>Retry panel</button></div>
    return this.props.children
  }
}
