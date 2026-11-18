import { useEffect, useLayoutEffect, useRef, useState } from 'react';
export function useReducedMotion() {
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return reduced;
}
// Original SVG dimensions are untouched. Scale only their surrounding coordinate system.
export function useArtScale(baseWidth) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => {
      const bounds = element.getBoundingClientRect();
      const scale = bounds.width / baseWidth;
      element.style.setProperty('--art-scale', String(scale));
      element.style.setProperty('--art-height', `${bounds.height / scale}px`);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [baseWidth]);
  return ref;
}
// Fit the original vector coordinate system to the available first-screen height.
// Portrait screens rearrange the copy and shrink only the character, without
// stretching the artwork. Text has separate portrait sizing; buttons stay readable.
export function useHeroLayout() {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const scene = ref.current;
    if (!scene) return;
    const update = () => {
      const { width, height } = scene.getBoundingClientRect();
      if (!width || !height) return;
      const stacked = width < 760 || width / height < 1.8;
      const scale = height / 820;
      const center = stacked ? 1982.8126 : 2042.641968;
      const characterScale = stacked ? Math.min(.84, width * .82 / (536.932 * scale)) : .93;
      const characterCenter = stacked ? 1982.8126 : 1998;
      const characterLeft = characterCenter - 536.932 * characterScale / 2;
      // Anchor the visible front toes, not the transparent bottom of the SVG.
      // This short section of the supporting branch slopes down to the right.
      const branchOffset = stacked ? 0 : 120;
      const toeX = characterLeft + 458 * characterScale - branchOffset;
      const branchSurfaceY = 505 + (toeX - 2057) * .09;
      const values = {
        '--scene-scale': scale,
        '--scene-width': `${width}px`,
        '--scene-height': `${height}px`,
        '--scene-left': `${width / (2 * scale) - center}px`,
        '--copy-left': `${width / (2 * scale) - 960}px`,
        '--character-scale': characterScale,
        '--character-left': `${characterLeft}px`,
        '--character-top': `${branchSurfaceY - 267 * characterScale}px`,
      };
      scene.dataset.layout = stacked ? 'stacked' : 'wide';
      Object.entries(values).forEach(([name, value]) => scene.style.setProperty(name, String(value)));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(scene);
    return () => observer.disconnect();
  }, []);
  return ref;
}
export function useAnimatedNumber(target, reduced, duration = 460) {
  const [value, setValue] = useState(target);
  const current = useRef(target);
  useEffect(() => {
    if (reduced) { current.current = target; setValue(target); return; }
    const startValue = current.current;
    let frame;
    const started = performance.now();
    const update = (now) => {
      const progress = Math.min(1, (now - started) / duration);
      const next = startValue + (target - startValue) * (1 - Math.pow(1 - progress, 4));
      current.current = next;
      setValue(progress === 1 ? target : Math.round(next));
      if (progress < 1) frame = requestAnimationFrame(update);
    };
    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, [target, reduced, duration]);
  return value;
}
