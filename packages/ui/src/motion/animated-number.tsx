// @ts-nocheck
"use client";
// beui.dev/components/motion/number

import { animate, useInView, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { EASE_OUT } from "../../lib/ease";
import { cn } from "../../lib/utils";

export interface AnimatedNumberProps {
  value: number;
  duration?: number;
  format?: (n: number) => string;
  className?: string;
  startOnView?: boolean;
  /**
   * Round the animated value to this many decimals on every frame. Without it,
   * fractional values (currency, rates) flicker through noisy float precision
   * as they roll — e.g. `$0.000274` on the way to `$0.0013`.
   */
  decimals?: number;
  /** Set false to jump straight to the value instead of rolling to it. */
  animate?: boolean;
}

export function AnimatedNumber({
  value,
  duration = 1.2,
  format,
  className,
  startOnView = true,
  decimals,
  animate: animateProp = true,
}: AnimatedNumberProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.6 });
  const reduce = useReducedMotion();
  const roll = animateProp && !reduce;
  const [display, setDisplay] = useState(roll ? 0 : value);
  const fromRef = useRef(roll ? 0 : value);

  useEffect(() => {
    if (startOnView && !inView) return;
    if (!roll) {
      fromRef.current = value;
      setDisplay(value);
      return;
    }
    const controls = animate(fromRef.current, value, {
      duration,
      ease: EASE_OUT,
      onUpdate: (v) => setDisplay(v),
    });
    fromRef.current = value;
    return () => controls.stop();
  }, [value, duration, inView, startOnView, roll]);

  const render = format ?? ((n: number) => Math.round(n).toLocaleString());
  const shown = decimals === undefined ? display : Number(display.toFixed(decimals));

  return (
    <span ref={ref} className={cn("tabular-nums", className)}>
      {render(shown)}
    </span>
  );
}
