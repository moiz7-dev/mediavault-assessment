import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallbackMessage: string;
}

interface State {
  error: Error | null;
}

/**
 * Keeps a component-level failure (a malformed asset, a rendering bug) from blanking the
 * whole page. Each boundary offers a way back — resetting its own state re-mounts just that
 * subtree, not the app — rather than forcing a full reload.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('MediaVault: component failed to render', error, info.componentStack);
  }

  private reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      return (
        <div className="empty">
          <p className="error">{this.props.fallbackMessage}</p>
          <button onClick={this.reset}>Try again</button>
        </div>
      );
    }
    return this.props.children;
  }
}
