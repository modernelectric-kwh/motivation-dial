// ── Powerdialer route layout ──
// The dashboard was merged into Memory Center (/). This route only serves
// as a layout wrapper for child routes (/powerdialer/call, /queue, etc.).

import { createFileRoute, Outlet, useRouterState } from "@tanstack/react-router";

export const Route = createFileRoute("/powerdialer")({
  head: () => ({
    meta: [
      { title: "Powerdialer · ME" },
      { name: "description", content: "V9 relationship call console." },
    ],
  }),
  component: PowerdialerLayout,
});

function PowerdialerLayout() {
  const isIndex = useRouterState({ select: (s) => s.location.pathname === "/powerdialer" });

  // Redirect bare /powerdialer to home (merged dashboard)
  if (!isIndex) return <Outlet />;

  if (typeof window !== "undefined") {
    window.location.replace("/");
    return null;
  }
  return null;
}
