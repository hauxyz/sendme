"use client";

import { useMemo, useState } from "react";

type Point = { date: string; sent: number; opened: number; failed?: number; clicked?: number };

const WIDTH = 760;
const HEIGHT = 250;
const PAD = { top: 18, right: 14, bottom: 30, left: 38 };

function niceMax(value: number): number {
  if (value <= 4) return 4;
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
  const normalized = value / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

export function EmailChart({ data }: { data: Point[] }) {
  const [active, setActive] = useState<number | null>(null);
  const points = useMemo(() => (data.length ? data : [{ date: "", sent: 0, opened: 0 }]), [data]);
  const max = niceMax(Math.max(...points.map((point) => Math.max(point.sent, point.opened, 1))));
  const innerW = WIDTH - PAD.left - PAD.right;
  const innerH = HEIGHT - PAD.top - PAD.bottom;
  const x = (index: number) => PAD.left + (points.length === 1 ? innerW / 2 : (index / (points.length - 1)) * innerW);
  const y = (value: number) => PAD.top + innerH - (value / max) * innerH;

  const line = (key: "sent" | "opened") =>
    points.map((point, index) => `${index === 0 ? "M" : "L"} ${x(index).toFixed(1)} ${y(point[key]).toFixed(1)}`).join(" ");

  const area = `${line("sent")} L ${x(points.length - 1).toFixed(1)} ${PAD.top + innerH} L ${x(0).toFixed(1)} ${PAD.top + innerH} Z`;
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const labelEvery = Math.max(1, Math.ceil(points.length / 6));
  const activePoint = active !== null ? points[active] : null;

  return (
    <div className="relative">
      <div className="mb-1 flex h-8 items-center justify-between">
        <div className="flex items-center gap-4 text-[11px]">
          <span className="flex items-center gap-1.5 text-zinc-400">
            <span className="h-1.5 w-3 rounded-full bg-violet-400" /> Sent
          </span>
          <span className="flex items-center gap-1.5 text-zinc-400">
            <span className="h-1.5 w-3 rounded-full bg-emerald-400/80" /> Opened
          </span>
        </div>
        {activePoint ? (
          <div className="flex items-center gap-3 text-[11px] tabular-nums text-zinc-400">
            <span className="text-zinc-500">{formatDay(activePoint.date)}</span>
            <span className="text-violet-300">{activePoint.sent} sent</span>
            <span className="text-emerald-300">{activePoint.opened} opened</span>
          </div>
        ) : (
          <span className="text-[11px] text-zinc-600">Hover for daily detail</span>
        )}
      </div>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-full" role="img" aria-label="Email activity chart">
        <defs>
          <linearGradient id="sentFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0" />
          </linearGradient>
        </defs>

        {ticks.map((tick) => {
          const value = Math.round(max * tick);
          const lineY = y(value);
          return (
            <g key={tick}>
              <line
                x1={PAD.left}
                x2={WIDTH - PAD.right}
                y1={lineY}
                y2={lineY}
                stroke="rgba(255,255,255,0.055)"
                strokeDasharray={tick === 0 ? "0" : "3 4"}
              />
              <text x={PAD.left - 10} y={lineY + 3} textAnchor="end" fill="#52525b" fontSize="10" fontFamily="var(--font-sans)">
                {value}
              </text>
            </g>
          );
        })}

        <path d={area} fill="url(#sentFill)" />
        <path d={line("sent")} fill="none" stroke="#8b5cf6" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        <path d={line("opened")} fill="none" stroke="#34d399" strokeOpacity="0.8" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" strokeDasharray="4 4" />

        {active !== null ? (
          <>
            <line
              x1={x(active)}
              x2={x(active)}
              y1={PAD.top}
              y2={PAD.top + innerH}
              stroke="rgba(255,255,255,0.14)"
              strokeDasharray="3 3"
            />
            <circle cx={x(active)} cy={y(points[active].sent)} r="3.5" fill="#8b5cf6" stroke="#08080a" strokeWidth="2" />
            <circle cx={x(active)} cy={y(points[active].opened)} r="3" fill="#34d399" stroke="#08080a" strokeWidth="2" />
          </>
        ) : null}

        {points.map((point, index) => (
          <g key={`${point.date}-${index}`}>
            {index % labelEvery === 0 || index === points.length - 1 ? (
              <text x={x(index)} y={HEIGHT - 8} textAnchor="middle" fill="#52525b" fontSize="10" fontFamily="var(--font-sans)">
                {formatDay(point.date)}
              </text>
            ) : null}
            <rect
              x={points.length === 1 ? PAD.left : x(index) - innerW / Math.max(1, points.length - 1) / 2}
              y={PAD.top}
              width={points.length === 1 ? innerW : innerW / Math.max(1, points.length - 1)}
              height={innerH}
              fill="transparent"
              onMouseEnter={() => setActive(index)}
              onMouseLeave={() => setActive(null)}
            />
          </g>
        ))}
      </svg>
    </div>
  );
}

function formatDay(value: string): string {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(date);
}
