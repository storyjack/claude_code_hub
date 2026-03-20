import React from 'react';
import { useApp } from '../AppContext';

export default function EmptyState({ onAddProject }) {
  const { t: i } = useApp();
  return (
    <div className="empty-state">
      <div className="empty-state-icon">
        <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
          <rect x="8" y="12" width="48" height="40" rx="4" stroke="currentColor" strokeWidth="2" opacity="0.3"/>
          <path d="M8 20h48" stroke="currentColor" strokeWidth="2" opacity="0.3"/>
          <path d="M32 30v12M26 36h12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" opacity="0.5"/>
        </svg>
      </div>
      <h2>{i("emptyTitle")}</h2>
      <p>{i("emptyDesc")}</p>
      <div className="empty-steps">
        <div className="step">{i("step1")}</div>
        <div className="step">{i("step2")}</div>
        <div className="step">{i("step3")}</div>
      </div>
      <button className="btn-primary" onClick={onAddProject}>
        + {i("addProject")}
      </button>
    </div>
  );
}
