"use client";

import { signOut } from "next-auth/react";
import { useState } from "react";

type UserMenuProps = {
  name: string;
  image?: string | null;
};

export default function UserMenu({ name, image }: UserMenuProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex items-center gap-2 rounded-full border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-200"
      >
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={image} alt={name} className="h-6 w-6 rounded-full" />
        ) : (
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-600 text-xs">
            {name.slice(0, 1).toUpperCase()}
          </span>
        )}
        <span>{name}</span>
      </button>

      {open ? (
        <div className="absolute right-0 mt-2 w-48 rounded-xl border border-slate-700 bg-slate-900 p-2 text-sm shadow-xl">
          <a
            href="/settings"
            className="block rounded-lg px-3 py-2 text-slate-200 hover:bg-slate-800"
            onClick={() => setOpen(false)}
          >
            Settings
          </a>
          <button
            type="button"
            className="mt-1 w-full rounded-lg px-3 py-2 text-left text-rose-200 hover:bg-slate-800"
            onClick={() => signOut({ callbackUrl: "/" })}
          >
            Sign Out
          </button>
        </div>
      ) : null}
    </div>
  );
}
