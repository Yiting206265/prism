'use client';

import { useEffect, useRef, useState } from 'react';

function useCountUp(target: number, durationMs = 900) {
  const [value, setValue] = useState(0);
  const frameRef = useRef<number>();

  useEffect(() => {
    if (target <= 0) {
      setValue(0);
      return;
    }

    const start = performance.now();
    const from = 0;

    function tick(now: number) {
      const progress = Math.min((now - start) / durationMs, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(from + (target - from) * eased));
      if (progress < 1) frameRef.current = requestAnimationFrame(tick);
    }

    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [target, durationMs]);

  return value;
}

function HeroStat({
  value,
  label,
  loading,
}: {
  value: number;
  label: string;
  loading?: boolean;
}) {
  const animated = useCountUp(loading ? 0 : value);
  return (
    <div className="hero-stat">
      <span className="hero-stat-value">
        {loading ? '—' : animated.toLocaleString()}
      </span>
      <span className="hero-stat-label">{label}</span>
    </div>
  );
}

interface Props {
  categoryCode: string;
  categoryLabel: string;
  sourceLabel: string;
  newToday: number;
  newTodayLabel: string;
  showing: number;
  categoriesLive: number;
  categoriesLiveLabel: string;
  statsLoading: boolean;
  asOf?: string | null;
}

function formatToday(asOf?: string | null) {
  const d = asOf ? new Date(asOf) : new Date();
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function Hero({
  categoryCode,
  categoryLabel,
  sourceLabel,
  newToday,
  newTodayLabel,
  showing,
  categoriesLive,
  categoriesLiveLabel,
  statsLoading,
  asOf,
}: Props) {
  return (
    <section className="hero-banner" aria-label="Today's research briefing">
      <div className="hero-banner-media" aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/hero-banner.jpg"
          alt=""
          className="hero-banner-img"
          width={1920}
          height={1080}
        />
        <div className="hero-banner-scrim" />
      </div>

      <div className="hero-banner-inner">
        <div className="hero-banner-panel">
          <div className="hero-banner-overline">
            <span>Today&apos;s {sourceLabel}</span>
            <span className="hero-banner-dot" aria-hidden="true" />
            <span>{formatToday(asOf)}</span>
            <span className="hero-banner-dot" aria-hidden="true" />
            <span className="hero-banner-code">{categoryCode}</span>
          </div>

          <h1 className="hero-banner-headline">
            Research, refracted.
          </h1>

          <p className="hero-banner-field">
            <span className="hero-banner-field-label">Now viewing</span>
            <span className="hero-banner-field-name">{categoryLabel}</span>
          </p>

          <div className="hero-banner-stats">
            <HeroStat
              value={newToday}
              label={newTodayLabel}
              loading={statsLoading}
            />
            <HeroStat value={showing} label="Showing" />
            <HeroStat
              value={categoriesLive}
              label={categoriesLiveLabel}
              loading={statsLoading}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
