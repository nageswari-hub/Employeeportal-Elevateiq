'use client';
import React, { useEffect, useState } from 'react';
import './auth-landing.css';

export function AuthFrame({ children }: { children: React.ReactNode }) {
  const [scale, setScale] = useState(1);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    function handleResize() {
      const mob = window.innerWidth < 760;
      setIsMobile(mob);
      if (!mob) {
        setScale(Math.min(window.innerWidth / 1024, window.innerHeight / 576));
      }
    }
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <div className={`landing-root ${isMobile ? 'mob' : ''}`}>
      <div className="bg" aria-hidden="true" />

      <div
        className="fit"
        id="fit"
        style={{
          transform: isMobile ? undefined : `scale(${scale})`,
        }}
      >
        <div className="stage">
          {/* Logo */}
          <img className="a logo" src="/assets/logo.png" alt="ElevateIQ" />

          {/* Subtitle */}
          <div className="a sub">EMPLOYEE PORTAL</div>

          {/* Headline */}
          <h1 className="a" aria-label="One calm place for tasks, reports and training.">
            <span>One calm place for</span>
            <span>tasks, reports and</span>
            <span>training.</span>
          </h1>

          {/* Underline path */}
          <svg className="a ul" viewBox="0 0 200 14" aria-hidden="true">
            <path d="M2 9C50 3 130 3 196 7" />
          </svg>

          {/* Lead text */}
          <p className="a lead">
            Plan the week, finish the work, file your daily report and keep learning — all in one private workspace.
          </p>

          {/* Feature list */}
          <ul className="a feats">
            <li style={{ ['--i' as any]: 0 }}>
              <span className="ic">
                <svg viewBox="0 0 24 24">
                  <path d="m6 12.5 4 4 8-9" />
                </svg>
              </span>
              Tasks with a clear review flow
            </li>
            <li style={{ ['--i' as any]: 1 }}>
              <span className="ic">
                <svg viewBox="0 0 24 24">
                  <path d="M6 19v-6M12 19V6M18 19v-9" />
                </svg>
              </span>
              Daily reports before 6 PM
            </li>
            <li style={{ ['--i' as any]: 2 }}>
              <span className="ic">
                <svg viewBox="0 0 24 24">
                  <path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H4v1a3 3 0 0 0 4 3M16 6h4v1a3 3 0 0 1-4 3M12 13v4M8 20h8" />
                </svg>
              </span>
              Day-wise training and quizzes
            </li>
            <li style={{ ['--i' as any]: 3 }}>
              <span className="ic">
                <svg viewBox="0 0 24 24">
                  <path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0" />
                </svg>
              </span>
              Live chat and notifications
            </li>
          </ul>

          {/* Laptop Preview */}
          <div className="a shot" role="img" aria-label="Laptop showing a task list" />

          {/* Interactive Card (Login, Change Password, etc.) */}
          {children}
        </div>
      </div>
    </div>
  );
}
