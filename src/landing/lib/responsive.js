import { useLayoutEffect, useState } from 'react';

// Approved frames on Figma page 386:24. Artwork and cards share one coordinate
// system, keeping gradient crossings attached to the rounded white card edges.
export const layouts = {
  desktop: { width: 1920, height: 840, artTop: 0, artHeight: 840, left: [264, 200, 832, 512], right: [1120, 200, 536, 512], gap: 24 },
  laptop: { width: 1440, height: 766, artTop: 128, artHeight: 590, left: [64, 228, 760, 430], right: [848, 228, 528, 430], gap: 24 },
  landscape: { width: 1024, height: 846, artTop: 128, artHeight: 670, left: [64, 228, 514, 510], right: [602, 228, 358, 510], gap: 24 },
  tablet: { width: 768, height: 1390, artTop: 128, artHeight: 1214, left: [64, 260, 640, 524], right: [64, 816, 640, 430], gap: 32 },
  large: { width: 430, height: 1326, artTop: 136, artHeight: 1166, left: [24, 220, 382, 556], right: [24, 800, 382, 434], gap: 24 },
  mobile: { width: 390, height: 1326, artTop: 136, artHeight: 1166, left: [24, 220, 342, 556], right: [24, 800, 342, 434], gap: 24 },
  compact: { width: 360, height: 1370, artTop: 136, artHeight: 1210, left: [24, 220, 312, 556], right: [24, 800, 312, 478], gap: 24 },
};

export function getLayout(width) {
  const name = width >= 1680 ? 'desktop' : width >= 1280 ? 'laptop' : width >= 1000 ? 'landscape' : width >= 700 ? 'tablet' : width >= 412 ? 'large' : width >= 375 ? 'mobile' : 'compact';
  const layout = layouts[name];
  const contentWidth = Math.min(width, name === 'desktop' ? 1920 : width < 700 ? 480 : width);
  return { ...layout, name, contentWidth, scale: contentWidth / layout.width, stacked: width < 1000, phone: width < 700 };
}

export function useViewportWidth() {
  const [width, setWidth] = useState(() => document.documentElement.getBoundingClientRect().width || window.innerWidth);
  useLayoutEffect(() => {
    // The rendered root keeps its reserved scrollbar gutter while a dialog is
    // open; clientWidth changes on overflow locking even when the layout does not.
    const update = () => setWidth(document.documentElement.getBoundingClientRect().width || window.innerWidth);
    const observer = new ResizeObserver(update);
    observer.observe(document.documentElement);
    update();
    return () => observer.disconnect();
  }, []);
  return width;
}

function between(width, low, high, a, b) {
  return a + Math.max(0, Math.min(1, (width - low) / (high - low))) * (b - a);
}

export function getHeroLayout(width) {
  if (width < 700) {
    const scale = Math.min(.5, width / 720);
    return { mode: 'phone', height: 554, scale, left: width * .48 - 1982.8125 * scale,
      cropTop: 216, cropHeight: 378, artTop: -112.9092 * (scale / .5), upperScale: .5,
      upperLeft: width * .48 - 1982.8125 * .5, titleY: 50, titleCenter: width / 2,
      titleSize: Math.min(88, (width - 40) / 3.82), titleLine: 94,
      sloganY: 144, sloganX: 24, sloganWidth: width - 48, sloganSize: 26, sloganLine: 30 };
  }
  if (width < 1000) {
    const u = width / 768;
    return { mode: 'tablet', height: 614.1818 * u, scale: .65 * u,
      left: -935.5481 * u, cropTop: 260 * u, cropHeight: 459 * u,
      artTop: -180 * u, upperScale: .45 * u, upperLeft: -538.9856 * u,
      titleY: 90 * u, titleCenter: width / 2, titleSize: 90 * u, titleLine: 104 * u,
      sloganY: 198 * u, sloganX: 32 * u, sloganWidth: width - 64 * u,
      sloganSize: 26 * u, sloganLine: 32 * u };
  }
  const scale = width < 1440 ? between(width, 1024, 1440, .67, .8) : between(width, 1440, 1920, .8, 1);
  const titleSize = width < 1440 ? between(width, 1024, 1440, 116, 150) : between(width, 1440, 1920, 150, 190);
  const sloganSize = width < 1440 ? between(width, 1024, 1440, 28, 34) : between(width, 1440, 1920, 34, 44);
  return { mode: 'desktop', height: 821.818176 * scale, scale,
    left: width * .46 - 1982.8125 * scale, cropTop: 0, cropHeight: 981.818176 * scale,
    artTop: 0, upperScale: scale, upperLeft: width * .46 - 1982.8125 * scale,
    titleY: 85 * scale, titleCenter: width * .46 - between(width, 1024, 1440, 0, 24),
    titleSize, titleLine: width < 1440 ? between(width, 1024, 1440, 133, 173) : between(width, 1440, 1920, 173, 218),
    sloganY: 330 * scale, sloganX: width * .63, sloganWidth: width * .29,
    sloganSize, sloganLine: width < 1440 ? between(width, 1024, 1440, 32, 40) : between(width, 1440, 1920, 40, 50) };
}
