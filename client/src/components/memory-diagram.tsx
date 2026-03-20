import { useState } from "react";

const tooltips: Record<string, string> = {
  start: "A new Claude Code session begins. Claude reads your project files to build its understanding.",
  claudemd: "Loaded when you cd into the project directory. Defines coding conventions, architecture, and key commands. One per project.",
  memorymd: "Index file loaded every session. Links to all memory files. Hard limit: 200 lines — anything beyond is invisible to Claude. Keep it as a pure index.",
  feedback: "Corrections and guidance you gave Claude — 'don't do X', 'keep doing Y'. Prevents repeating the same mistakes across sessions.",
  project: "Ongoing work context — goals, deadlines, decisions. Helps Claude understand the bigger picture behind your requests.",
  reference: "Pointers to external resources — IPs, URLs, dashboards, issue trackers. Where to find things outside the codebase.",
  user: "Information about you — role, expertise, preferences. Helps Claude tailor responses to your level and style.",
  context: "Everything Claude 'knows' at any point in the conversation. Larger always-loaded files = less room for actual work.",
  skill: "Reusable slash commands (e.g., /commit). Only loaded into context when you invoke them — no cost when not used. No line limit.",
};

interface NodeProps {
  x: number; y: number; w: number; h: number;
  label: string; sublabel?: string;
  borderColor: string; bgColor: string; textColor: string;
  id: string;
  hovered: string | null;
  onHover: (id: string | null) => void;
}

function DiagramNode({ x, y, w, h, label, sublabel, borderColor, bgColor, textColor, id, hovered, onHover }: NodeProps) {
  const isHovered = hovered === id;
  const isDimmed = hovered !== null && !isHovered;
  return (
    <g
      onMouseEnter={() => onHover(id)}
      onMouseLeave={() => onHover(null)}
      style={{ cursor: "default", opacity: isDimmed ? 0.25 : 1, transition: "opacity 0.2s" }}
    >
      <rect x={x} y={y} width={w} height={h} rx={8} fill={bgColor} stroke={borderColor} strokeWidth={isHovered ? 2 : 1.5} />
      <text x={x + w / 2} y={y + (sublabel ? h / 2 - 6 : h / 2 + 1)} textAnchor="middle" dominantBaseline="middle" fill={textColor} fontSize={12} fontWeight={600}>{label}</text>
      {sublabel && <text x={x + w / 2} y={y + h / 2 + 10} textAnchor="middle" dominantBaseline="middle" fill={textColor} fontSize={9} opacity={0.7}>{sublabel}</text>}
    </g>
  );
}

function AnimatedLine({ x1, y1, x2, y2, hovered, relatedIds }: { x1: number; y1: number; x2: number; y2: number; hovered: string | null; relatedIds?: string[] }) {
  const isDimmed = hovered !== null && relatedIds && !relatedIds.includes(hovered);
  return (
    <line
      x1={x1} y1={y1} x2={x2} y2={y2}
      stroke="rgba(148,163,184,0.3)"
      strokeWidth={1.5}
      strokeDasharray="4 3"
      opacity={isDimmed ? 0.1 : 1}
      style={{ transition: "opacity 0.2s" }}
    >
      <animate attributeName="stroke-dashoffset" from="0" to="-14" dur="1.5s" repeatCount="indefinite" />
    </line>
  );
}

function Callout({ x, y, text, emoji }: { x: number; y: number; text: string; emoji: string }) {
  return (
    <foreignObject x={x} y={y} width={160} height={36}>
      <div style={{ fontSize: 9, color: "rgba(148,163,184,0.8)", display: "flex", gap: 3, alignItems: "flex-start", lineHeight: 1.3 }}>
        <span>{emoji}</span>
        <span>{text}</span>
      </div>
    </foreignObject>
  );
}

export default function MemoryDiagram() {
  const [hovered, setHovered] = useState<string | null>(null);

  // Layout constants
  const W = 680;
  const H = 520;
  const cx = W / 2;

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 520 }}>
        {/* Background */}
        <rect width={W} height={H} fill="transparent" />

        {/* Flow lines */}
        <AnimatedLine x1={cx} y1={40} x2={cx} y2={70} hovered={hovered} relatedIds={["start"]} />
        {/* Always loaded to three branches */}
        <AnimatedLine x1={cx} y1={110} x2={120} y2={148} hovered={hovered} relatedIds={["claudemd"]} />
        <AnimatedLine x1={cx} y1={110} x2={cx} y2={148} hovered={hovered} relatedIds={["memorymd"]} />
        <AnimatedLine x1={cx} y1={110} x2={540} y2={148} hovered={hovered} relatedIds={["feedback","project","reference","user"]} />
        {/* MEMORY.md arrow to memory files */}
        <AnimatedLine x1={390} y1={190} x2={430} y2={190} hovered={hovered} relatedIds={["memorymd","feedback","project","reference","user"]} />
        {/* Memory files down to context */}
        <AnimatedLine x1={120} y1={230} x2={cx} y2={375} hovered={hovered} relatedIds={["claudemd","context"]} />
        <AnimatedLine x1={cx} y1={230} x2={cx} y2={375} hovered={hovered} relatedIds={["memorymd","context"]} />
        <AnimatedLine x1={540} y1={340} x2={cx} y2={375} hovered={hovered} relatedIds={["feedback","project","reference","user","context"]} />
        {/* Context to skill */}
        <AnimatedLine x1={cx} y1={420} x2={cx} y2={455} hovered={hovered} relatedIds={["context","skill"]} />

        {/* Session Starts */}
        <DiagramNode x={cx - 80} y={10} w={160} h={30} label="Session Starts" borderColor="rgba(148,163,184,0.3)" bgColor="rgba(148,163,184,0.05)" textColor="rgba(148,163,184,0.8)" id="start" hovered={hovered} onHover={setHovered} />

        {/* Always Loaded banner */}
        <rect x={cx - 100} y={70} width={200} height={40} rx={6} fill="rgba(59,130,246,0.08)" stroke="rgba(59,130,246,0.2)" strokeWidth={1} />
        <text x={cx} y={85} textAnchor="middle" fill="rgba(59,130,246,0.8)" fontSize={11} fontWeight={600}>Always Loaded</text>
        <text x={cx} y={100} textAnchor="middle" fill="rgba(59,130,246,0.5)" fontSize={9}>(every session)</text>

        {/* CLAUDE.md */}
        <DiagramNode x={30} y={148} w={180} h={82} label="CLAUDE.md" sublabel="Project rules, architecture" borderColor="rgba(59,130,246,0.4)" bgColor="rgba(59,130,246,0.06)" textColor="rgba(96,165,250,1)" id="claudemd" hovered={hovered} onHover={setHovered} />

        {/* MEMORY.md */}
        <DiagramNode x={250} y={148} w={140} h={82} label="MEMORY.md" sublabel="Index file (max 200 lines)" borderColor="rgba(148,163,184,0.4)" bgColor="rgba(148,163,184,0.06)" textColor="rgba(148,163,184,0.9)" id="memorymd" hovered={hovered} onHover={setHovered} />

        {/* Memory Files group */}
        <rect x={420} y={140} width={240} height={200} rx={8} fill="rgba(148,163,184,0.03)" stroke="rgba(148,163,184,0.15)" strokeWidth={1} strokeDasharray="3 2" />
        <text x={540} y={160} textAnchor="middle" fill="rgba(148,163,184,0.5)" fontSize={10}>Memory Files (all linked)</text>

        {/* Feedback */}
        <DiagramNode x={435} y={172} w={105} h={36} label="Feedback" borderColor="rgba(245,158,11,0.4)" bgColor="rgba(245,158,11,0.06)" textColor="rgba(245,158,11,0.9)" id="feedback" hovered={hovered} onHover={setHovered} />
        {/* Project */}
        <DiagramNode x={547} y={172} w={100} h={36} label="Project" borderColor="rgba(59,130,246,0.4)" bgColor="rgba(59,130,246,0.06)" textColor="rgba(96,165,250,0.9)" id="project" hovered={hovered} onHover={setHovered} />
        {/* Reference */}
        <DiagramNode x={435} y={215} w={105} h={36} label="Reference" borderColor="rgba(34,197,94,0.4)" bgColor="rgba(34,197,94,0.06)" textColor="rgba(34,197,94,0.9)" id="reference" hovered={hovered} onHover={setHovered} />
        {/* User */}
        <DiagramNode x={547} y={215} w={100} h={36} label="User" borderColor="rgba(168,85,247,0.4)" bgColor="rgba(168,85,247,0.06)" textColor="rgba(168,85,247,0.9)" id="user" hovered={hovered} onHover={setHovered} />

        {/* Callouts */}
        <Callout x={250} y={235} text="200 line hard limit — lines beyond are truncated" emoji="&#9888;&#65039;" />
        <Callout x={435} y={260} text="Aim for < 100 lines per file" emoji="&#128207;" />

        {/* Context */}
        <DiagramNode x={cx - 130} y={375} w={260} h={45} label="Claude's Context" sublabel="What Claude 'knows' this session" borderColor="rgba(34,197,94,0.3)" bgColor="rgba(34,197,94,0.05)" textColor="rgba(34,197,94,0.9)" id="context" hovered={hovered} onHover={setHovered} />

        {/* Callout for context */}
        <Callout x={cx + 140} y={380} text="Smaller always-loaded files = more room for work" emoji="&#128161;" />

        {/* Skill */}
        <DiagramNode x={cx - 80} y={455} w={160} h={45} label="Skills (/commands)" sublabel="Only loaded when invoked" borderColor="rgba(249,115,22,0.4)" bgColor="rgba(249,115,22,0.06)" textColor="rgba(249,115,22,0.9)" id="skill" hovered={hovered} onHover={setHovered} />

        {/* Callout for skill */}
        <Callout x={cx + 90} y={462} text="No line limit — only loaded on demand" emoji="&#9989;" />
      </svg>

      {/* Tooltip */}
      {hovered && tooltips[hovered] && (
        <div className="absolute bottom-2 left-2 right-2 bg-card/95 backdrop-blur border border-border rounded-lg px-3 py-2 text-xs text-muted-foreground shadow-lg">
          {tooltips[hovered]}
        </div>
      )}
    </div>
  );
}
