import { NavLink } from "react-router-dom";
import { Search, TrendingUp, ListMusic, Heart, Settings } from "lucide-react";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const mobileNavItems = [
  { to: "/search", icon: Search, labelKey: "nav.search" },
  { to: "/library", icon: TrendingUp, labelKey: "nav.library" },
  { to: "/hot-playlists", icon: ListMusic, labelKey: "nav.playlists" },
  { to: "/favorites", icon: Heart, labelKey: "nav.favorites" },
  { to: "/settings", icon: Settings, labelKey: "nav.settings" },
];

export function MobileNav() {
  const t = useT();

  return (
    <nav className="md:hidden flex items-center justify-around border-t border-border/70 bg-sidebar/95 backdrop-blur-md px-2 py-1.5 pb-[max(0.5rem,env(safe-area-inset-bottom))] shrink-0 select-none z-30">
      {mobileNavItems.map(({ to, icon: Icon, labelKey }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) =>
            cn(
              "flex flex-col items-center justify-center gap-1 py-1 px-3 rounded-lg text-[11px] font-medium transition-colors",
              isActive
                ? "text-primary font-semibold"
                : "text-muted-foreground hover:text-foreground",
            )
          }
        >
          {({ isActive }) => (
            <>
              <Icon
                size={20}
                strokeWidth={isActive ? 2.4 : 1.8}
                className={cn(
                  "transition-transform",
                  isActive && "scale-110 text-primary",
                )}
              />
              <span className="leading-tight">{t(labelKey)}</span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
