// Catches a crash in part of the page and says so, instead of React leaving the whole page blank.
import { RotateCcwIcon, TriangleAlertIcon } from 'lucide-react';
import { Component, type ReactNode } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

export class ErrorBoundary extends Component<{ children: ReactNode; where: string; padded?: boolean }, { error?: Error }> {
  state: { error?: Error } = {};

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error(`The admin page's ${this.props.where} crashed:`, error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <Alert variant="destructive" className={this.props.padded ? 'mx-auto my-10 w-[calc(100%-2rem)] max-w-2xl' : 'my-6'}>
        <TriangleAlertIcon />
        <AlertTitle>Something went wrong in {this.props.where}</AlertTitle>
        <AlertDescription className="flex flex-col gap-3">
          <span className="font-mono text-xs break-all">{this.state.error.message}</span>
          <span className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => this.setState({ error: undefined })}>
              <RotateCcwIcon /> Try again
            </Button>
            <Button size="sm" variant="outline" onClick={() => window.location.reload()}>
              Reload the page
            </Button>
          </span>
        </AlertDescription>
      </Alert>
    );
  }
}
