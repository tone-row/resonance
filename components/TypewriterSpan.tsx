"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";

interface TypewriterSpanProps {
  text: string;
  /** Speed in milliseconds per character */
  speed?: number;
  /** Whether to animate (false = show immediately) */
  animate?: boolean;
  /** Callback when typing is complete */
  onComplete?: () => void;
  className?: string;
}

export function TypewriterSpan({
  text,
  speed = 50,
  animate = true,
  onComplete,
  className = "",
}: TypewriterSpanProps) {
  const [visibleCount, setVisibleCount] = useState(animate ? 0 : text.length);
  const containerRef = useRef<HTMLSpanElement>(null);
  const hasScrolledRef = useRef(false);

  // Split text into characters, preserving the structure
  const characters = useMemo(() => text.split(""), [text]);

  // Scroll into view on initial mount (once only)
  useEffect(() => {
    if (!hasScrolledRef.current && containerRef.current && animate) {
      hasScrolledRef.current = true;
      // Small delay to let the first character render
      requestAnimationFrame(() => {
        containerRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      });
    }
  }, [animate]);

  useEffect(() => {
    if (!animate) {
      setVisibleCount(text.length);
      return;
    }

    // Reset when text changes
    setVisibleCount(0);

    let currentIndex = 0;
    const interval = setInterval(() => {
      currentIndex++;
      setVisibleCount(currentIndex);

      if (currentIndex >= characters.length) {
        clearInterval(interval);
        onComplete?.();
      }
    }, speed);

    return () => clearInterval(interval);
  }, [text, animate, speed, characters.length, onComplete]);

  return (
    <span ref={containerRef} className={`${className} highlight-new`}>
      <AnimatePresence mode="popLayout">
        {characters.slice(0, visibleCount).map((char, index) => (
          <motion.span
            key={`${index}-${char}`}
            initial={{
              opacity: 0,
              y: Math.floor(Math.random() * 10) - 5,
              filter: "blur(1.5px)",
            }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={{
              duration: 0.5,
              ease: [0.23, 1, 0.32, 1],
            }}
            style={{
              display: "inline-block",
              // Preserve whitespace width for spaces
              whiteSpace: char === " " ? "pre" : undefined,
            }}
          >
            {char}
          </motion.span>
        ))}
      </AnimatePresence>
    </span>
  );
}
