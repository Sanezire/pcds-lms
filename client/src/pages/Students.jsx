import StudentRecords from '../components/StudentRecords.jsx';

export default function Students() {
  return (
    <div className="stats">
      <header className="stats-head">
        <h1>Students</h1>
        <p className="lead">Student records: add students one by one or import a CSV file.</p>
      </header>
      <StudentRecords />
    </div>
  );
}
