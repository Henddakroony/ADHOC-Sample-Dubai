import { useState, useEffect, useRef } from "react";

const MESSAGES = [
  "Initializing Dashboard...",
  "Connecting to ArcGIS Online...",
  "Reading Feature Layer Data...",
  "Processing Market Intelligence...",
  "Building Visualizations...",
  "Calculating KPIs...",
  "Preparing Analytics Dashboard...",
  "Finalizing Insights...",
];

export interface LoadingState {
  visible: boolean;
  fadingOut: boolean;
  message: string;
  messageIndex: number;
  pct: number;
}

export function useLoadingState(
  loading: boolean,
  loadingProgress: number,
  loadingTotal: number
): LoadingState {
  const [visible, setVisible] = useState(true);
  const [fadingOut, setFadingOut] = useState(false);
  const [messageIndex, setMessageIndex] = useState(0);
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const msgTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hasEverLoaded = useRef(false);

  const pct =
    loadingTotal > 0
      ? Math.min(Math.round((loadingProgress / loadingTotal) * 100), 99)
      : 0;

  useEffect(() => {
    if (loading) {
      hasEverLoaded.current = true;
      if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
      setFadingOut(false);
      setVisible(true);

      if (msgTimerRef.current) clearInterval(msgTimerRef.current);
      setMessageIndex(0);

      let idx = 0;
      msgTimerRef.current = setInterval(() => {
        idx = Math.min(idx + 1, MESSAGES.length - 1);
        setMessageIndex(idx);
        if (idx === MESSAGES.length - 1 && msgTimerRef.current) {
          clearInterval(msgTimerRef.current);
        }
      }, 900);
    } else if (hasEverLoaded.current) {
      if (msgTimerRef.current) clearInterval(msgTimerRef.current);
      setMessageIndex(MESSAGES.length - 1);

      fadeTimerRef.current = setTimeout(() => {
        setFadingOut(true);
        fadeTimerRef.current = setTimeout(() => {
          setVisible(false);
          setFadingOut(false);
        }, 700);
      }, 600);
    }

    return () => {
      if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
      if (msgTimerRef.current) clearInterval(msgTimerRef.current);
    };
  }, [loading]);

  return {
    visible,
    fadingOut,
    message: MESSAGES[messageIndex],
    messageIndex,
    pct: loading ? pct : 100,
  };
}
