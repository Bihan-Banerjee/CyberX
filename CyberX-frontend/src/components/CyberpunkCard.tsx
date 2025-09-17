export type CyberpunkCardProps = {
  title?: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm?: () => void;
  onCancel?: () => void;
  children?: React.ReactNode;   // 👈 NEW — allow children here
  red?: string;
  deepRed?: string;
  panelAlpha?: number;
  showBackground?: boolean;
  width?: number;
};

export default function CyberpunkCard({
  title = "Error",
  message = "",
  confirmText = "Confirm",
  cancelText = "Cancel",
  onConfirm,
  onCancel,
  children,                     // 👈 include children
  red = "#ff2b45",
  deepRed = "#d50f2f",
  panelAlpha = 0.6,
  showBackground = true,
  width = 720,
}: CyberpunkCardProps) {
  const css = `
    .cp-root{ --cp-red:${red}; --cp-red-2:${deepRed}; --cp-dark:#0b0002; --cp-bg-1:#2a0006; --cp-bg-2:#0a0001; --cp-panel: rgb(10 0 2 / ${panelAlpha}); --cp-cyan:#6de8ff; --cp-amber:#ffb300; --cp-radius:12px; --cp-border:1px; --cp-glow: 0 0 .75rem rgb(255 43 69 / .55), 0 0 2.25rem rgb(255 43 69 / .35); --cp-soft-shadow: 0 10px 30px rgb(0 0 0 / .6); }
    .cp-screen{ min-height:100dvh; display:grid; place-items:center; padding:24px; background-image: linear-gradient(160deg, var(--cp-bg-1) 0%, var(--cp-bg-2) 70%); color:#f6e9ea; }
    .cp-card{ position:relative; width:min(${width}px, 92vw); padding:20px 20px 16px; border-radius:var(--cp-radius); background:var(--cp-panel); border:var(--cp-border) solid var(--cp-red); box-shadow: var(--cp-soft-shadow), var(--cp-glow); -webkit-backdrop-filter: blur(8px) saturate(120%); backdrop-filter: blur(8px) saturate(120%); overflow:hidden; }
    .cp-card::before{ content:""; position:absolute; inset:0 0 auto 0; height:3px; background: linear-gradient(90deg, transparent, var(--cp-red), var(--cp-red-2), transparent); opacity:.9; pointer-events:none; }
    .cp-card::after{ content:""; position:absolute; inset:0; background: linear-gradient(180deg, rgb(255 255 255 / .04), transparent 15% 85%, rgb(255 255 255 / .03)); mix-blend-mode: screen; pointer-events:none; }
    .cp-header{ display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:12px; }
    .cp-title{ margin:0; font-size:1.1rem; letter-spacing:.06em; text-transform:uppercase; color:#ffd6dc; text-shadow: 0 0 6px rgb(255 43 69 / .45), 0 0 16px rgb(255 43 69 / .25); animation: cp-flicker 5s linear infinite; }
    @keyframes cp-flicker{ 0%,100%{opacity:.95;} 45%{opacity:.80;} 47%{opacity:.98;} 50%{opacity:.70;} 55%{opacity:.96;} }
    @media (prefers-reduced-motion: reduce){ .cp-title{ animation:none; } }
    .cp-chip{ display:inline-flex; align-items:center; gap:.4ch; border:1px solid currentColor; padding:.25rem .5rem; border-radius:8px; font-size:.8rem; letter-spacing:.04em; color:var(--cp-amber); }
    .cp-text{ margin:8px 0 16px; opacity:.9; line-height:1.4; }
    .cp-actions{ display:flex; gap:10px; }
    .cp-btn{ background: color-mix(in srgb, var(--cp-red) 12%, transparent); color:#ffe7eb; border:1px solid var(--cp-red); padding:.6rem 1rem; border-radius:10px; letter-spacing:.04em; cursor:pointer; box-shadow: 0 0 0 1px rgb(255 43 69 / .25) inset, var(--cp-glow); transition: transform .08s ease, box-shadow .2s ease, background-color .2s ease; }
    .cp-btn:hover{ background: color-mix(in srgb, var(--cp-red) 22%, transparent); box-shadow: 0 0 0 1px rgb(255 43 69 / .35) inset, var(--cp-glow); transform: translateY(-1px); }
    .cp-btn:active{ transform: translateY(0); }
    .cp-btn--ghost{ background: transparent; color:#ffb6c0; box-shadow:none; border-color: color-mix(in srgb, var(--cp-red) 65%, transparent); }
    .cp-btn:focus-visible{ outline:none; box-shadow: 0 0 0 2px rgb(0 0 0 / .9), 0 0 0 4px color-mix(in srgb, var(--cp-red) 60%, #ffffff); }
  `;

  const Card = (
    <div className="cp-card">
      <div className="cp-header">
        <h3 className="cp-title">{title}</h3>
      </div>
      {message && <p className="cp-text">{message}</p>}

      {/* 👇 Render custom content if provided */}
      {children && <div className="cp-children mt-4">{children}</div>}

      <div className="cp-actions mt-4">
        <button className="cp-btn" onClick={onConfirm}>
          {confirmText}
        </button>
        <button className="cp-btn cp-btn--ghost" onClick={onCancel}>
          {cancelText}
        </button>
      </div>
    </div>
  );

  return (
    <div className="cp-root">
      <style>{css}</style>
      {showBackground ? <div className="cp-screen">{Card}</div> : Card}
    </div>
  );
}
