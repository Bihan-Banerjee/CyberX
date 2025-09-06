// src/pages/Home.tsx
import React from "react";
import { Link } from "react-router-dom";
import CyberpunkCard from "@/components/CyberpunkCard";
const NAV_H = 80; 

export default function Home() {
  return (
    <section
      className="
        relative z-20 grid
        min-h-[calc(100svh-var(--nav-h,80px))] place-items-center
        px-6
        ml-75
        -mt-20   /* remove this line if main no longer has pt-20 */
      "
      style={{ ["--nav-h" as any]: `${NAV_H}px` }}
    >
      {/* subtle global overlay for readability */}
      <div className="pointer-events-none fixed inset-0 -z-[1] bg-gradient-to-b from-black/35 via-black/20 to-black/45" />

      {/* centered glass card */}
      <div
        className="
          mx-auto w-fit max-w-[90vw] sm:max-w-3xl md:max-w-4xl
          bg-black/30 backdrop-blur-xl
          border border-white/10 rounded-2xl
          shadow-2xl ring-1 ring-white/5
          px-8 py-10 text-center
        "
      >
        <h1
          className="
            text-4xl sm:text-5xl md:text-6xl font-extrabold tracking-tight
            text-transparent bg-clip-text
            bg-gradient-to-r from-cyan-300 via-fuchsia-300 to-pink-300
            drop-shadow-[0_2px_8px_rgba(0,0,0,0.45)]
          "
        >
          CyberX — <span className="text-white/95">Simulate</span>.{" "}
          <span className="text-white/95">Secure</span>.{" "}
          <span className="text-white/95">Succeed</span>.
        </h1>

        <p className="mt-5 text-lg md:text-xl text-white/90 drop-shadow-md">
          Everything cybersecurity under one umbrella.
        </p>

        <div className="mt-8 flex items-center justify-center gap-4">
          <Link
            to="/tools"
            className="rounded-lg px-5 py-3 bg-cyan-500/15 text-cyan-200 border border-cyan-400/25 hover:bg-cyan-500/25"
          >
            Explore Tools
          </Link>
          <Link
            to="/honeypot"
            className="rounded-lg px-5 py-3 bg-pink-500/15 text-pink-200 border border-pink-400/25 hover:bg-pink-500/25"
          >
            Launch Honeypots
          </Link>
        </div>
      </div>
    </section>
  );
}
