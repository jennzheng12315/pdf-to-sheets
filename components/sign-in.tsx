"use client";

import { signIn } from "next-auth/react";

export default function SignIn() {
  return (
    <button
      type="button"
      onClick={() => signIn("google")}
      className="rounded-lg bg-cyan-400 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300"
    >
      Sign in with Google
    </button>
  );
}
