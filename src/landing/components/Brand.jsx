import { useArtScale } from '../lib/useMotion.js';

// The approved transparent avatar retains its original 1024px viewBox.
// Only the wrapper scales it; the artwork is never cropped or stretched.
export default function Brand({ className, homeLabel }) {
  const markRef = useArtScale(802.62066);
  return <a className={`brand ${className || ''}`} href="#home" aria-label={homeLabel}>
    <span ref={markRef} className="brand-mark" aria-hidden="true"><span className="brand-mark-coordinate">
      <img src="/icons/logo.svg" width="1024" height="1024" alt="" />
    </span></span>
    <span>Service Portal</span>
  </a>;
}
