import { useSearchParams } from 'react-router-dom';
import StudentRecords from '../components/StudentRecords.jsx';

export default function Students() {
  const [params, setParams] = useSearchParams();
  const view = params.get('view') === 'deactivation' ? 'deactivation' : 'records';
  return (
    <div className="stats">
      <header className="stats-head">
        <div className="view-tabs" role="tablist" aria-label="Student screens">
          <button type="button" role="tab" aria-selected={view === 'records'} className={`view-tab${view === 'records' ? ' is-active' : ''}`} onClick={() => setParams({}, { replace: true })}>Student Records</button>
          <button type="button" role="tab" aria-selected={view === 'deactivation'} className={`view-tab${view === 'deactivation' ? ' is-active' : ''}`} onClick={() => setParams({ view: 'deactivation' }, { replace: true })}>Student Deactivation</button>
        </div>
        <p className="lead">{view === 'records' ? 'Add, import and manage student records.' : 'Deactivate students individually, in groups, or by importing student IDs.'}</p>
      </header>
      <StudentRecords key={view} view={view} />
    </div>
  );
}
