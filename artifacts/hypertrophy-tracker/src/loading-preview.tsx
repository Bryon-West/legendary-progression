import { createRoot } from 'react-dom/client';
import { Loading } from './components/ui-bits';
import './index.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing loading preview root');
createRoot(root).render(<Loading label="Loading app" />);