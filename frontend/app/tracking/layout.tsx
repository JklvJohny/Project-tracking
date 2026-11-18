import type { ReactNode } from 'react';
import { TrackingProvider } from './shared/provider';
import './tracking.css';

// Ships to the host app. The provider is a no-op when the host (or the dev shell) already mounted one.
// No tab bar: Projects and Reports are reached from the host sidebar.
export default function TrackingLayout({ children }: { children: ReactNode }) {
  return (
    <TrackingProvider>
      <div className="tracking-root min-h-full">
        {children}
      </div>
    </TrackingProvider>
  );
}
