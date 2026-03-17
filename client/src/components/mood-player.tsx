import { useState, useEffect, useRef, useCallback, createContext, useContext } from "react";
import { Play, Pause } from "lucide-react";
import { cn } from "@/lib/utils";

declare global {
  interface Window {
    YT: any;
    onYouTubeIframeAPIReady: () => void;
  }
}

const VIDEO_ID = "RjM8d0Csuk4";

interface MoodContextType {
  playing: boolean;
  ready: boolean;
  toggle: () => void;
}

const MoodContext = createContext<MoodContextType>({ playing: false, ready: false, toggle: () => {} });

export function useMoodPlayer() {
  return useContext(MoodContext);
}

/** Hidden iframe + context provider — lives in Layout so it persists across pages */
export function MoodPlayerProvider({ children }: { children: React.ReactNode }) {
  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(false);
  const playerRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const initPlayer = useCallback(() => {
    if (playerRef.current || !containerRef.current) return;
    playerRef.current = new window.YT.Player("mood-yt-player", {
      height: "1",
      width: "1",
      videoId: VIDEO_ID,
      playerVars: {
        autoplay: 0,
        controls: 0,
        disablekb: 1,
        fs: 0,
        modestbranding: 1,
        rel: 0,
        loop: 1,
        playlist: VIDEO_ID,
      },
      events: {
        onReady: (event: any) => {
          event.target.setPlaybackQuality("small");
          setReady(true);
        },
        onStateChange: (event: any) => {
          if (event.data === 0) {
            event.target.seekTo(0);
            event.target.playVideo();
          }
        },
      },
    });
  }, []);

  useEffect(() => {
    if (window.YT && window.YT.Player) {
      initPlayer();
      return;
    }
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(tag);
    window.onYouTubeIframeAPIReady = initPlayer;
    return () => {
      window.onYouTubeIframeAPIReady = () => {};
    };
  }, [initPlayer]);

  const toggle = useCallback(() => {
    if (!playerRef.current || !ready) return;
    if (playing) {
      playerRef.current.pauseVideo();
    } else {
      playerRef.current.playVideo();
      playerRef.current.setPlaybackQuality("small");
    }
    setPlaying((p) => !p);
  }, [playing, ready]);

  return (
    <MoodContext.Provider value={{ playing, ready, toggle }}>
      {/* Hidden YouTube player */}
      <div
        ref={containerRef}
        style={{ position: "fixed", width: 1, height: 1, overflow: "hidden", opacity: 0, pointerEvents: "none", top: 0, left: 0, zIndex: -1 }}
      >
        <div id="mood-yt-player" />
      </div>
      {children}
    </MoodContext.Provider>
  );
}

const MOOD_MESSAGES = [
  "Are you ready?",
  "Fasten your seat belt.",
  "Fix your eyes on the prize.",
  "Calm your mind.",
  "Steady your breath.",
  "Feel the tension.",
  "Embrace the pressure.",
  "Ignore the noise.",
  "Trust the process.",
  "Hold your ground.",
  "Move with precision.",
  "Stay relentless.",
  "Stay hungry.",
  "Nothing can stop you now.",
  "This moment is yours.",
  "Make it count.",
];

/** Visible play/pause control — used in the Dashboard header */
export function MoodPlayerButton() {
  const { playing, ready, toggle } = useMoodPlayer();
  const [msgIndex, setMsgIndex] = useState(0);
  const [visible, setVisible] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [mousePos, setMousePos] = useState({ x: 50, y: 50 });
  const [hovered, setHovered] = useState(false);
  const [showLines, setShowLines] = useState(false);

  useEffect(() => {
    if (!playing) {
      setShowLines(false);
      return;
    }
    const timer = setTimeout(() => setShowLines(true), 7000);
    return () => clearTimeout(timer);
  }, [playing]);

  useEffect(() => {
    if (!playing) {
      setMsgIndex(0);
      setVisible(false);
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }

    setVisible(true);
    let idx = 0;

    intervalRef.current = setInterval(() => {
      setVisible(false);
      setTimeout(() => {
        idx++;
        if (idx >= MOOD_MESSAGES.length) {
          idx = MOOD_MESSAGES.length - 1;
          setMsgIndex(idx);
          setVisible(true);
          if (intervalRef.current) clearInterval(intervalRef.current);
          return;
        }
        setMsgIndex(idx);
        setVisible(true);
      }, 800);
    }, 5000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [playing]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const btn = btnRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    setMousePos({
      x: ((e.clientX - rect.left) / rect.width) * 100,
      y: ((e.clientY - rect.top) / rect.height) * 100,
    });
  }, []);

  const glowStyle: React.CSSProperties = {
    ...(playing ? { animation: "mood-glow 3s ease-in-out infinite, mood-border 4s ease-in-out infinite" } : {}),
    // Cursor-tracking light spot
    ...(hovered ? {
      background: `radial-gradient(circle 80px at ${mousePos.x}% ${mousePos.y}%, rgba(6,182,212,0.18) 0%, rgba(168,85,247,0.06) 50%, transparent 100%)`,
    } : {}),
  };

  return (
    <div
      className="relative group"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onMouseMove={handleMouseMove}
    >
      {/* Tron edge-light trace — runs around the border on hover */}
      <div
        className={cn(
          "absolute -inset-[1px] rounded-full opacity-0 transition-opacity duration-300 pointer-events-none",
          hovered && "opacity-100"
        )}
        style={{
          background: `conic-gradient(from ${mousePos.x * 3.6}deg at ${mousePos.x}% ${mousePos.y}%, transparent 0%, rgba(6,182,212,0.6) 8%, rgba(168,85,247,0.5) 16%, transparent 24%, transparent 100%)`,
          filter: "blur(1px)",
        }}
      />
      {/* Outer neon bloom on hover */}
      <div
        className={cn(
          "absolute -inset-1 rounded-full opacity-0 transition-opacity duration-500 pointer-events-none",
          hovered && "opacity-100"
        )}
        style={{
          boxShadow: `0 0 15px rgba(6,182,212,0.25), 0 0 30px rgba(168,85,247,0.15), 0 0 60px rgba(6,182,212,0.08)`,
        }}
      />

      <button
        ref={btnRef}
        onClick={toggle}
        disabled={!ready}
        className={cn(
          "relative flex items-center gap-2 rounded-full px-3 py-1.5 text-xs border transition-all duration-500 overflow-hidden",
          playing
            ? "border-purple-500/35 text-purple-200"
            : "border-border/50 text-muted-foreground",
          hovered && !playing && "border-cyan-400/40 text-cyan-300",
          hovered && playing && "border-cyan-400/30",
          !ready && "opacity-40 cursor-not-allowed"
        )}
        style={glowStyle}
      >
        {/* Light Cycle jetwall race — blue leads, orange chases */}
        {showLines && (
          <div className="absolute inset-0 pointer-events-none overflow-hidden rounded-full">
            {/* Blue cycle — in the lead */}
            <div
              className="absolute top-[38%] h-[2px]"
              style={{
                width: "100%",
                background: "rgba(6,182,212,0.9)",
                boxShadow: "0 0 4px rgba(6,182,212,0.6), 0 0 8px rgba(6,182,212,0.3)",
                animation: "lc-race-blue 10.2s linear infinite",
              }}
            >
              <div className="absolute left-0 top-[-2px] w-[6px] h-[6px] rounded-full" style={{
                background: "white",
                boxShadow: "0 0 6px rgba(6,182,212,1), 0 0 12px rgba(56,189,248,0.8), 0 0 20px rgba(6,182,212,0.4)",
              }} />
              {/* Speed lines around head */}
              <div className="absolute top-[-4px] left-[2%] w-[6px] h-[1px] bg-white/50" />
              <div className="absolute top-[4px] left-[1%] w-[8px] h-[1px] bg-white/45" />
              <div className="absolute top-[-3px] left-[4%] w-[5px] h-[1px] bg-white/40" />
              {/* Speed lines along trail */}
              <div className="absolute top-[-1px] left-[12%] w-[8px] h-[1px] bg-white/35" />
              <div className="absolute top-[2px] left-[25%] w-[12px] h-[1px] bg-white/25" />
              <div className="absolute top-[-2px] left-[40%] w-[6px] h-[1px] bg-white/30" />
              <div className="absolute top-[3px] left-[55%] w-[10px] h-[1px] bg-white/20" />
              <div className="absolute top-[-1px] left-[72%] w-[7px] h-[1px] bg-white/25" />
            </div>
            {/* Orange cycle — slightly behind blue */}
            <div
              className="absolute top-[62%] h-[2px]"
              style={{
                width: "100%",
                background: "rgba(251,191,36,0.85)",
                boxShadow: "0 0 4px rgba(251,191,36,0.5), 0 0 8px rgba(245,158,11,0.3)",
                animation: "lc-race-orange 10.2s linear infinite",
              }}
            >
              <div className="absolute left-0 top-[-2px] w-[6px] h-[6px] rounded-full" style={{
                background: "white",
                boxShadow: "0 0 6px rgba(251,191,36,1), 0 0 12px rgba(245,158,11,0.8), 0 0 20px rgba(251,191,36,0.4)",
              }} />
              {/* Speed lines around head */}
              <div className="absolute top-[-4px] left-[2%] w-[7px] h-[1px] bg-white/45" />
              <div className="absolute top-[4px] left-[1.5%] w-[6px] h-[1px] bg-white/45" />
              <div className="absolute top-[-3px] left-[4.5%] w-[5px] h-[1px] bg-white/40" />
              {/* Speed lines along trail */}
              <div className="absolute top-[-1px] left-[15%] w-[10px] h-[1px] bg-white/30" />
              <div className="absolute top-[2px] left-[30%] w-[7px] h-[1px] bg-white/25" />
              <div className="absolute top-[-2px] left-[48%] w-[9px] h-[1px] bg-white/20" />
              <div className="absolute top-[3px] left-[62%] w-[6px] h-[1px] bg-white/30" />
              <div className="absolute top-[-1px] left-[78%] w-[11px] h-[1px] bg-white/22" />
            </div>
          </div>
        )}

        {/* Scan line — sweeps on hover */}
        <div
          className={cn(
            "absolute inset-0 pointer-events-none opacity-0 transition-opacity duration-200",
            hovered && "opacity-100"
          )}
          style={{
            background: `linear-gradient(90deg, transparent 0%, transparent ${mousePos.x - 8}%, rgba(6,182,212,0.12) ${mousePos.x - 2}%, rgba(6,182,212,0.25) ${mousePos.x}%, rgba(6,182,212,0.12) ${mousePos.x + 2}%, transparent ${mousePos.x + 8}%, transparent 100%)`,
          }}
        />

        <div className={cn(
          "w-6 h-6 rounded-full flex items-center justify-center transition-all duration-500 shrink-0",
          playing
            ? "bg-purple-500/30 shadow-[0_0_14px_rgba(168,85,247,0.4)]"
            : "bg-muted/30",
          hovered && !playing && "bg-cyan-500/20 shadow-[0_0_12px_rgba(6,182,212,0.35)]",
          hovered && playing && "shadow-[0_0_18px_rgba(6,182,212,0.3),0_0_14px_rgba(168,85,247,0.4)]",
        )}>
          {playing ? (
            <Pause className={cn("h-3 w-3 text-purple-300 transition-colors duration-300", hovered && "text-cyan-300")} />
          ) : (
            <Play className={cn("h-3 w-3 ml-0.5 text-purple-400 transition-colors duration-300", hovered && "text-cyan-300")} />
          )}
        </div>
        <span
          className={cn(
            "font-medium text-[11px] whitespace-nowrap min-w-[130px] text-center transition-all relative z-10",
            playing
              ? visible
                ? "opacity-100 blur-0 duration-700"
                : "opacity-0 blur-[2px] duration-500"
              : "opacity-100 blur-0 duration-300",
            hovered && !playing && "text-cyan-200",
          )}
        >
          {playing ? MOOD_MESSAGES[msgIndex] : "Get In The Mood"}
        </span>
        {playing && (
          <div className="flex items-end gap-[2px] h-3 ml-0.5 relative z-10">
            <span className={cn("w-[2px] rounded-full transition-all duration-300 animate-[eq1_16s_ease-in-out_infinite]", hovered ? "bg-gradient-to-t from-cyan-500 to-cyan-300" : "bg-gradient-to-t from-purple-500 to-purple-300")} />
            <span className={cn("w-[2px] rounded-full transition-all duration-300 animate-[eq2_19s_ease-in-out_infinite]", hovered ? "bg-gradient-to-t from-cyan-400 to-cyan-200" : "bg-gradient-to-t from-pink-500 to-pink-300")} />
            <span className={cn("w-[2px] rounded-full transition-all duration-300 animate-[eq3_15s_ease-in-out_infinite]", hovered ? "bg-gradient-to-t from-cyan-500 to-cyan-300" : "bg-gradient-to-t from-purple-500 to-purple-300")} />
            <span className={cn("w-[2px] rounded-full transition-all duration-300 animate-[eq4_17s_ease-in-out_infinite]", hovered ? "bg-gradient-to-t from-cyan-400 to-cyan-200" : "bg-gradient-to-t from-pink-500 to-pink-300")} />
            <span className={cn("w-[2px] rounded-full transition-all duration-300 animate-[eq5_20s_ease-in-out_infinite]", hovered ? "bg-gradient-to-t from-cyan-500 to-cyan-300" : "bg-gradient-to-t from-purple-500 to-purple-300")} />
          </div>
        )}
      </button>
    </div>
  );
}
