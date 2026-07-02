import Link from "next/link";
import { getSessionUser } from "@/lib/auth";

export async function Nav() {
  const user = await getSessionUser();
  if (!user) return null;

  return (
    <nav className="sticky top-0 z-50 border-b border-brass-700/30 bg-ink-600/85 backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm">
        <Link
          href="/"
          className="font-display text-xs uppercase tracking-[0.28em] text-brass-400 hover:text-brass-300 sm:tracking-[0.4em]"
        >
          Plum Tabletop
        </Link>
        <ul className="order-3 flex w-full gap-1 overflow-x-auto sm:order-none sm:w-auto sm:gap-3">
          <NavLink href="/campaigns">Campaigns</NavLink>
          <NavLink href="/srd">SRD</NavLink>
          {user.isDM ? <NavLink href="/dm">DM</NavLink> : null}
          {user.isDM ? <NavLink href="/dm/settings">Settings</NavLink> : null}
        </ul>
        <span className="hidden text-[11px] text-ink-200 sm:inline">
          {user.name ?? user.username}
        </span>
      </div>
    </nav>
  );
}

function NavLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <li>
      <Link
        href={href}
        className="rounded-md px-2 py-1 text-ink-100 transition hover:bg-brass-700/20 hover:text-parchment-100"
      >
        {children}
      </Link>
    </li>
  );
}
