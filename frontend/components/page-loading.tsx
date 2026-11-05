export function PageLoading() {
  return <div className="page-loading" role="status" aria-label="Yuklanmoqda / Loading">
    <div className="page-loading-heading" />
    <div className="page-loading-description" />
    <div className="page-loading-grid">{[0, 1, 2, 3].map(index => <div key={index} />)}</div>
    <span className="sr-only">Yuklanmoqda…</span>
  </div>;
}
