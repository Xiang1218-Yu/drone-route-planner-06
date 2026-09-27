import { forwardRef, type PointerEvent as ReactPointerEvent, type Ref } from 'react';
import { routePoints } from './geometry';
import type { Point, RoutePlan } from './types';

type RouteCanvasProps = {
  plan: Pick<RoutePlan, 'canvas' | 'start' | 'end' | 'waypoints' | 'noFlyZones'>;
  /** 需要高亮为风险（红色虚线）的航段下标集合 */
  riskSegments?: ReadonlySet<number>;
  /** 编辑态：正在绘制但尚未完成的多边形草稿（只读页不传） */
  draftPolygon?: Point[];
  interactive?: boolean;
  onCanvasClick?: (event: ReactPointerEvent<SVGSVGElement>) => void;
  onCanvasPointerUp?: (event: ReactPointerEvent<SVGSVGElement>) => void;
};

const ticksOf = (max: number) => Array.from({ length: Math.floor(max / 10) + 1 }, (_, index) => index * 10);

const RouteCanvas = forwardRef(function RouteCanvas(
  { plan, riskSegments = new Set<number>(), draftPolygon = [], interactive = false, onCanvasClick, onCanvasPointerUp }: RouteCanvasProps,
  ref: Ref<SVGSVGElement>
) {
  const { width, height } = plan.canvas;
  const points = routePoints(plan);

  return (
    <svg
      ref={ref}
      className={`route-canvas ${interactive ? 'is-interactive' : 'is-readonly'}`}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={interactive ? '无人机航线二维坐标画布（可编辑）' : '无人机航线二维坐标画布（只读快照）'}
      onClick={onCanvasClick}
      onPointerUp={onCanvasPointerUp}
      pointerEvents={interactive ? 'auto' : 'none'}
    >
      <defs>
        <pattern id="minorGrid" width="5" height="5" patternUnits="userSpaceOnUse"><path d="M 5 0 L 0 0 0 5" fill="none" stroke="#dbe8e7" strokeWidth="0.22" /></pattern>
        <pattern id="majorGrid" width="10" height="10" patternUnits="userSpaceOnUse"><rect width="10" height="10" fill="url(#minorGrid)" /><path d="M 10 0 L 0 0 0 10" fill="none" stroke="#b9d1d0" strokeWidth="0.32" /></pattern>
        <filter id="routeGlow"><feGaussianBlur stdDeviation="0.7" result="coloredBlur" /><feMerge><feMergeNode in="coloredBlur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
      </defs>
      <rect width={width} height={height} fill="#f7fbfa" />
      <rect width={width} height={height} fill="url(#majorGrid)" />
      {plan.noFlyZones.map((zone) => <polygon key={zone.id} points={zone.points.map((point) => `${point.x},${point.y}`).join(' ')} fill={zone.color ?? '#fb7185'} fillOpacity="0.19" stroke={zone.color ?? '#fb7185'} strokeWidth="0.7" strokeDasharray="1.5 1" />)}
      {draftPolygon.length > 0 && <><polyline points={draftPolygon.map((point) => `${point.x},${point.y}`).join(' ')} fill="none" stroke="#0f766e" strokeWidth="0.65" strokeDasharray="1.5 1" />{draftPolygon.map((point, index) => <circle key={index} cx={point.x} cy={point.y} r="1.15" fill="#0f766e" />)}</>}
      {points.slice(1).map((point, index) => <line key={index} x1={points[index].x} y1={points[index].y} x2={point.x} y2={point.y} stroke={riskSegments.has(index) ? '#ef4444' : '#0e7490'} strokeWidth={riskSegments.has(index) ? '1.1' : '0.85'} strokeLinecap="round" strokeDasharray={riskSegments.has(index) ? '2 1' : undefined} filter={riskSegments.has(index) ? undefined : 'url(#routeGlow)'} />)}
      {plan.waypoints.map((point, index) => <g key={`${point.x}-${point.y}-${index}`}><circle cx={point.x} cy={point.y} r="2" fill="#ffffff" stroke="#0e7490" strokeWidth="0.7" /><text x={point.x} y={point.y + 0.7} textAnchor="middle" fontSize="1.8" fontWeight="700" fill="#0e7490">{index + 1}</text></g>)}
      <g><circle cx={plan.start.x} cy={plan.start.y} r="2.6" fill="#0f766e" stroke="#ffffff" strokeWidth="0.8" /><text x={plan.start.x} y={plan.start.y + 0.9} textAnchor="middle" fontSize="2.5" fontWeight="800" fill="#ffffff">S</text></g>
      <g><circle cx={plan.end.x} cy={plan.end.y} r="2.6" fill="#e85d4a" stroke="#ffffff" strokeWidth="0.8" /><text x={plan.end.x} y={plan.end.y + 0.9} textAnchor="middle" fontSize="2.5" fontWeight="800" fill="#ffffff">E</text></g>
      {ticksOf(width).map((value) => <text key={`x-${value}`} x={value} y={height + 3.3} textAnchor={value === 0 ? 'start' : value >= width ? 'end' : 'middle'} fontSize="2.3" fill="#648383">{value}</text>)}
      {ticksOf(height).map((value) => <text key={`y-${value}`} x={-1.5} y={height - value + 0.8} textAnchor="end" fontSize="2.3" fill="#648383">{value}</text>)}
    </svg>
  );
});

export default RouteCanvas;
