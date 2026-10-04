import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight,
  Compass,
  Route,
  ShieldCheck,
  Sparkles,
  ChevronDown,
  ExternalLink,
  Layers,
  Activity,
  Info,
  Sliders,
} from 'lucide-react'
import LandingNav from '../components/layout/LandingNav'
import HeroRouteSvg from '../components/hero/HeroRouteSvg'
import ModelFeatureCards from '../components/landing/ModelFeatureCards'
import WorkflowTimeline from '../components/landing/WorkflowTimeline'
import StandaloneModelCards from '../components/landing/StandaloneModelCards'
import AboutSection from '../components/landing/AboutSection'
import LandingFooter from '../components/landing/LandingFooter'

export default function Landing() {
  const scrollTo = (e, targetId) => {
    e.preventDefault()
    const el = document.getElementById(targetId)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' })
    }
  }

  return (
    <div className="min-h-screen bg-[#05182B] text-[#EAF6FF] selection:bg-[#22E5F0]/30 selection:text-white font-sans antialiased">
      {/* Sticky Glassmorphism Navbar */}
      <LandingNav />

      {/* ================================================================ */}
      {/* 4. CINEMATIC FULL-SCREEN HERO                                   */}
      {/* ================================================================ */}
      <section className="relative min-h-screen flex items-center justify-center overflow-hidden pt-20 pb-16">
        {/* Background Hero Image */}
        <div className="absolute inset-0 z-0">
          <img
            src="/hero.jpg"
            alt="Antarctic deep ocean waters with icebergs and snowy mountain peaks"
            className="w-full h-full object-cover object-center transform scale-[1.01] transition-transform duration-1000"
            loading="eager"
          />
          {/* Carefully tuned dark-to-transparent Antarctic gradient overlays for optimal contrast and readability */}
          <div className="absolute inset-0 bg-gradient-to-t from-[#05182B] via-[#05182B]/60 to-[#05182B]/40" />
          <div className="absolute inset-0 bg-gradient-to-r from-[#05182B]/85 via-[#05182B]/45 to-transparent" />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-[#22E5F0]/10 via-transparent to-transparent" />
        </div>

        {/* Responsive Interactive SVG Route Overlay */}
        <HeroRouteSvg />

        {/* Hero Foreground Content */}
        <div className="relative z-20 mx-auto max-w-7xl px-5 sm:px-8 w-full pt-8">
          <div className="max-w-3xl">
            {/* Top Badge */}
            <div className="inline-flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[#22E5F0]/35 bg-[#22E5F0]/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-[#22E5F0] backdrop-blur-md">
                <Sparkles size={12} className="text-[#22E5F0]" />
                SIH Problem Statement 26059
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-[#071D33]/60 px-2.5 py-1 text-xs text-mist backdrop-blur-md">
                <ShieldCheck size={12} className="text-[#3AA7FF]" />
                Maritime Decision Support System
              </span>
            </div>

            {/* Exact Required Headline */}
            <h1 className="mt-6 font-display text-4xl sm:text-6xl lg:text-7xl font-extrabold tracking-tight text-white leading-[1.08] drop-shadow-[0_4px_16px_rgba(5,24,43,0.9)]">
              Navigate Polar Waters, <br />
              <span className="bg-gradient-to-r from-[#EAF6FF] via-[#A9DFFF] to-[#22E5F0] bg-clip-text text-transparent">
                Safely and Smartly.
              </span>
            </h1>

            {/* Official Product Positioning */}
            <p className="mt-5 text-base sm:text-xl text-[#EAF6FF]/90 font-normal leading-relaxed max-w-2xl drop-shadow">
              AI-assisted maritime route planning for safer and more efficient Antarctic operations.
            </p>

            {/* Exact Primary and Secondary CTAs */}
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <Link
                to="/route-planner"
                className="group relative inline-flex items-center gap-2.5 rounded-xl bg-gradient-to-r from-[#22E5F0] to-[#3AA7FF] px-6 py-3.5 text-sm font-bold text-[#05182B] shadow-[0_0_25px_rgba(34,229,240,0.4)] transition-all duration-300 hover:shadow-[0_0_35px_rgba(34,229,240,0.6)] hover:scale-[1.02] active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-[#22E5F0]"
              >
                <Compass size={18} className="transition-transform group-hover:rotate-45" />
                <span>Plan Your Route</span>
                <ArrowRight size={16} className="transition-transform group-hover:translate-x-1" />
              </Link>

              <a
                href="#workflow"
                onClick={(e) => scrollTo(e, 'workflow')}
                className="inline-flex items-center gap-2 rounded-xl border border-white/20 bg-[#071D33]/60 px-6 py-3.5 text-sm font-semibold text-white backdrop-blur-md transition hover:border-[#22E5F0]/50 hover:bg-[#0A2A4A]/60 focus:outline-none focus:ring-2 focus:ring-[#22E5F0]"
              >
                <span>See How It Works</span>
                <ChevronDown size={16} className="text-[#22E5F0]" />
              </a>
            </div>

            {/* Hero Stat Chips (Glassmorphism) */}
            <div className="mt-10 flex flex-wrap items-center gap-3">
              <div className="glass-chip flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold text-[#EAF6FF] shadow-sm">
                <span className="flex h-2 w-2 rounded-full bg-[#22E5F0] animate-pulse" />
                <span>Polar Route Intelligence</span>
              </div>

              <div className="glass-chip flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold text-[#EAF6FF] shadow-sm">
                <ShieldCheck size={14} className="text-[#3AA7FF]" />
                <span>Intelligent Hazard Analysis</span>
              </div>

              <div className="glass-chip flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold text-[#EAF6FF] shadow-sm">
                <Route size={14} className="text-[#22E5F0]" />
                <span>Optimized Route Planning</span>
              </div>
            </div>

            {/* Technical Verification Indicators */}
            <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-mist font-mono">
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                173 × 369 Grid @ 0.25°
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                167-Day 2026 Forecast
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-[#22E5F0]" />
                A* CostMap &amp; Safety Gate
              </span>
            </div>
          </div>
        </div>

        {/* Scroll down indicator */}
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 pointer-events-auto">
          <a
            href="#features"
            onClick={(e) => scrollTo(e, 'features')}
            aria-label="Scroll to features"
            className="flex flex-col items-center gap-1 text-[11px] font-mono text-mist hover:text-[#22E5F0] transition"
          >
            <span className="uppercase tracking-widest text-[9px]">Explore Capabilities</span>
            <ChevronDown size={14} className="animate-bounce text-[#22E5F0]" />
          </a>
        </div>
      </section>

      {/* ================================================================ */}
      {/* 7. THREE EXISTING AI MODELS — FEATURES SECTION                  */}
      {/* ================================================================ */}
      <ModelFeatureCards />

      {/* ================================================================ */}
      {/* 8. HOW IT WORKS — ANIMATED WORKFLOW                             */}
      {/* ================================================================ */}
      <WorkflowTimeline />

      {/* ================================================================ */}
      {/* 9. THREE STANDALONE MODEL INTERFACES                            */}
      {/* ================================================================ */}
      <StandaloneModelCards />

      {/* ================================================================ */}
      {/* 10. ABOUT SECTION                                               */}
      {/* ================================================================ */}
      <AboutSection />

      {/* ================================================================ */}
      {/* 11. PREMIUM FOOTER                                              */}
      {/* ================================================================ */}
      <LandingFooter />
    </div>
  )
}
