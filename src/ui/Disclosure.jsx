import { useId, useState } from 'react';

// Grid tracks can reverse direction mid-transition and follow content height.
export default function Disclosure({ label, className = '', open, onOpenChange, children }) {
  const [localOpen, setLocalOpen] = useState(false);
  const expanded = open ?? localOpen;
  const id = useId();
  return <div className={`disclosure ${className}`} data-expanded={expanded}>
    <button type="button" className="disclosure-toggle" aria-expanded={expanded} aria-controls={id}
      onClick={() => (onOpenChange ?? setLocalOpen)(!expanded)}>{label}</button>
    <div id={id} className="expand-track" data-expanded={expanded} inert={!expanded}>
      <div className="expand-clip">{children}</div>
    </div>
  </div>;
}
