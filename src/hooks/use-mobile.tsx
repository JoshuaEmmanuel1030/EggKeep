import * as React from "react";

const MOBILE_BREAKPOINT = 768;

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined);

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    };
    mql.addEventListener("change", onChange);
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return !!isMobile;
}

// Tablet landscape layout (sidebar + split views). Read synchronously on first
// render so the layout never flashes the mobile tree first. Guarded for jsdom,
// which has no matchMedia: tests get the mobile layout.
export const TABLET_LANDSCAPE_QUERY = "(min-width: 1024px) and (orientation: landscape)";

export function useIsTabletLandscape() {
  const [matches, setMatches] = React.useState(
    () => typeof window !== "undefined" && typeof window.matchMedia === "function" &&
      window.matchMedia(TABLET_LANDSCAPE_QUERY).matches
  );

  React.useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(TABLET_LANDSCAPE_QUERY);
    const onChange = () => setMatches(mql.matches);
    mql.addEventListener("change", onChange);
    onChange();
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return matches;
}
