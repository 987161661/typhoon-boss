import type { HTMLAttributes, ReactNode } from "react";

export function HudPanel({
  as: Component = "div",
  className = "",
  children,
  ...props
}: {
  as?: "div" | "aside" | "section" | "article";
  className?: string;
  children: ReactNode;
} & HTMLAttributes<HTMLElement>) {
  return (
    <Component className={`hud-panel ${className}`.trim()} {...props}>
      {children}
    </Component>
  );
}

export function StatusPill({ label, value, alert = false }: { label: string; value: ReactNode; alert?: boolean }) {
  return (
    <div className={`status-pill ${alert ? "is-alert" : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function MetricRow({
  icon,
  label,
  value,
  unit,
  hot = false
}: {
  icon?: ReactNode;
  label: string;
  value: ReactNode;
  unit?: string;
  hot?: boolean;
}) {
  return (
    <div className={`metric-row ${hot ? "is-hot" : ""}`}>
      <span className="metric-icon">{icon}</span>
      <span className="metric-label">{label}</span>
      <strong className="metric-value">{value}</strong>
      {unit ? <span className="metric-unit">{unit}</span> : null}
    </div>
  );
}

export function MiniReadout({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="mini-readout">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function ProvinceAlertCard({
  name,
  label,
  level,
  meta,
  className = "",
  onClick
}: {
  name: string;
  label: string;
  level: "high" | "mid" | "low" | "idle";
  meta?: string;
  className?: string;
  onClick?: () => void;
}) {
  const classes = `province-card level-${level} ${className}`.trim();
  const secondary = meta ?? alertMeta[level];

  if (onClick) {
    return (
      <button className={classes} type="button" onClick={onClick}>
        <span>{name}</span>
        <small>{secondary}</small>
        <strong>{label}</strong>
      </button>
    );
  }

  return (
    <div className={classes}>
      <span>{name}</span>
      <small>{secondary}</small>
      <strong>{label}</strong>
    </div>
  );
}

const alertMeta = {
  high: "HIGH ALERT",
  mid: "MEDIUM ALERT",
  low: "LOW ALERT",
  idle: "PATROL"
};
