import { useState, useEffect, useRef } from "react";

/**
 * Animated count-up hook using requestAnimationFrame with ease-out cubic curve.
 * Re-triggers when target changes.
 */
export function useCountUp(end: number, duration = 600): number {
  const [value, setValue] = useState(0);
  const rafRef = useRef<number>();
  const prevEndRef = useRef(0);

  useEffect(() => {
    const startVal = prevEndRef.current;
    prevEndRef.current = end;
    const startTime = performance.now();

    function animate(now: number) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(startVal + (end - startVal) * eased);
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(animate);
      }
    }

    rafRef.current = requestAnimationFrame(animate);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [end, duration]);

  return value;
}
