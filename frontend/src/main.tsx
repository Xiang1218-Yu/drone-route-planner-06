import { Suspense, lazy, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { readReviewTokenFromHash } from './reviewLinks';
import ReviewPage from './ReviewPage';
import './styles.css';

// 编辑工作台按需加载：只读审查页打开时，编辑相关模块（含编辑 / 撤销 API）不会进入初始包
const App = lazy(() => import('./App'));

function Router() {
  const [token, setToken] = useState<string | null>(() => readReviewTokenFromHash(window.location.hash));

  useEffect(() => {
    const onHashChange = () => setToken(readReviewTokenFromHash(window.location.hash));
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  if (token) return <ReviewPage token={token} />;

  return (
    <Suspense fallback={<div className="review-loading"><div className="review-spinner" /><div>正在加载 SkyRoute 工作台…</div></div>}>
      <App />
    </Suspense>
  );
}

createRoot(document.getElementById('root')!).render(<Router />);
