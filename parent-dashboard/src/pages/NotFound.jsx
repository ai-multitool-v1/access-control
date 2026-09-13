import { Link } from 'react-router-dom';
import { EmptyState, EmptyIcon } from '../components/ui.jsx';

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <EmptyState
        icon={<EmptyIcon />}
        title="Page not found"
        hint="The route you requested does not exist."
        action={<Link to="/dashboard" className="btn-primary mt-2">Back to dashboard</Link>}
      />
    </div>
  );
}
