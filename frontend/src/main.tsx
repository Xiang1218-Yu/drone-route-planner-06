import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import ReviewPage from './ReviewPage';
import './styles.css';

// 轻量路由：/r/:token 为只读审查页，其余路径进入编辑工作台。
// 只读页是独立组件，不挂载任何编辑工具或方案写接口。
const reviewMatch = window.location.pathname.match(/^\/r\/([A-Za-z0-9_-]+)\/?$/);
const root = createRoot(document.getElementById('root')!);

root.render(
  <StrictMode>{reviewMatch ? <ReviewPage token={reviewMatch[1]} /> : <App />}</StrictMode>
);
