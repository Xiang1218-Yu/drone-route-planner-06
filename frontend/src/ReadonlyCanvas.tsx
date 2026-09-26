import { useMemo } from 'react';
import { routePoints } from './geometry';
import type { RoutePlan, ValidationIssue } from './types';

function ticks(max: number): number[] {
  const step = max >= 80 ? 10 : 5;
  const values: number[] = [];
  for (let value = 0; value <= max; value += step) values.push(value);
  return values;
}

/**
 * 纯展示用画布：viewBox 直接来自快照里的 canvas，网格/坐标/禁飞区/风险航段
 * 全部按快照数据渲染，没有任何指针事件与编辑入口。
 */
export default function ReadonlyCanvas({ plan, issues }: { plan: RoutePlan; issues: ValidationIssue[] }) {
  const { width, height } = plan.canvas;
  const points = useMemo(() => routePoints(plan), [plan]);
  const riskSegments = new Set(
    issues
      .filter((issue) => issue.type === 'no-fly-zone' || issue.type === 'out-of-bounds')
      .map((issue) => issue.segmentIndex)
      .filter((index): index is number => index !== undefined)
  );

  return (
    <div className="canvas-wrap readonly-canvas-wrap">
      <svg
        className="route-canvas readonly-canvas"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMid meet"
        pointerEvents="none"
        role="img"
        aria-label="航线方案快照的二维坐标只读画布"
      >
        <defs>
          <pattern id="ro-minorGrid" width="5" height="5" patternUnits="userSpaceOnUse"><path d="M 5 0 L 0 0 0 5" fill="none" stroke="#dbe8e7" strokeWidth="0.22" /></pattern>
          <pattern id="ro-majorGrid" width="10" height="10" patternUnits="userSpaceOnUse"><rect width="10" height="10" fill="url(#ro-minorGrid)" /><path d="M 10 0 L 0 0 0 10" fill="none" stroke="#b9d1d0" strokeWidth="0.32" /></pattern>
        </defs>
        <rect width={width} height={height} fill="#f7fbfa" />
        <rect width={width} height={height} fill="url(#ro-majorGrid)" />
        {plan.noFlyZones.map((zone) => (
          <polygon
            key={zone.id}
            points={zone.points.map((point) => `${point.x},${point.y}`).join(' ')}
            fill={zone.color || '#fb7185'}
            fillOpacity="0.19"
            stroke={zone.color || '#fb7185'}
            strokeWidth="0.7"
            strokeDasharray="1.5 1"
          />
        ))}
        {points.slice(1).map((point, index) => (
          <line
            key={index}
            x1={points[index].x}
            y1={points[index].y}
            x2={point.x}
            y2={point.y}
            stroke={riskSegments.has(index) ? '#ef4444' : '#0e7490'}
            strokeWidth={riskSegments.has(index) ? '1.1' : '0.85'}
            strokeLinecap="round"
            strokeDasharray={riskSegments.has(index) ? '2 1' : undefined}
          />
        ))}
        {plan.waypoints.map((point, index) => (
          <g key={`${point.x}-${point.y}-${index}`}>
            <circle cx={point.x} cy={point.y} r="2" fill="#ffffff" stroke="#0e7490" strokeWidth="0.7" />
            <text x={point.x} y={point.y + 0.7} textAnchor="middle" fontSize="1.8" fontWeight="700" fill="#0e7490">{index + 1}</text>
          </g>
        ))}
        <g><circle cx={plan.start.x} cy={plan.start.y} r="2.6" fill="#0f766e" stroke="#ffffff" strokeWidth="0.8" /><text x={plan.start.x} y={plan.start.y + 0.9} textAnchor="middle" fontSize="2.5" fontWeight="800" fill="#ffffff">S</text></g>
        <g><circle cx={plan.end.x} cy={plan.end.y} r="2.6" fill="#e85d4a" stroke="#ffffff" strokeWidth="0.8" /><text x={plan.end.x} y={plan.end.y + 0.9} textAnchor="middle" fontSize="2.5" fontWeight="800" fill="#ffffff">E</text></g>
        {ticks(width).map((value) => (
          <text key={`x-${value}`} x={value} y={height + 3.3} textAnchor={value === 0 ? 'start' : value === width ? 'end' : 'middle'} fontSize="2.3" fill="#648383">{value}</text>
        ))}
        {ticks(height).map((value) => (
          <text key={`y-${value}`} x={-1.5} y={height - value + 0.8} textAnchor="end" fontSize="2.3" fill="#648383">{value}</text>
        ))}
      </svg>
      <div className="canvas-compass"><span>北</span><b>↑</b></div>
      <div className="canvas-legend"><span><i className="legend-line" />规划航线</span><span><i className="legend-zone" />禁飞区</span><span><i className="legend-risk" />风险航段</span></div>
      <div className="readonly-watermark">只读快照</div>
    </div>
  );
}
